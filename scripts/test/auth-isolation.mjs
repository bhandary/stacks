#!/usr/bin/env node
/**
 * Disposable-database proof for Google OIDC accounts and shelf isolation.
 * The identity provider is a local fixture, not Google. It never touches production.
 */
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { strict as assert } from "node:assert";
import { createWriteStream, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { copyFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { chromium } from "playwright";
import { startOidcFixture } from "./oidc-fixture.mjs";
import { oidcSignIn } from "./oidc-flow.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const PORT = 43183;
const PROD_PORT = 43185;
const BASE = `http://localhost:${PORT}`;
const PROD_BASE = `http://localhost:${PROD_PORT}`;
const ADMIN_URL = "postgres://stacks:stacks@127.0.0.1:5432/postgres";
const DB_NAME = "stacks_auth_d9ad";
const PROD_DB = "stacks_auth_prod_d9ad";
const NEXT_BIN = path.join(ROOT, "node_modules", ".bin", "next");
const ARTIFACTS = path.join(ROOT, "artifacts", "auth");
const CURSOR_ARTIFACTS = "/opt/cursor/artifacts";
const LOG_PATH = "/tmp/stacks-auth-next.log";
const SECRET = "test-only-auth-secret-not-for-production-use";
const LEGACY_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ORIGIN = BASE;

const evidence = { steps: [], base: BASE, provider: "stacks-test-oidc", google: false };

function log(name, detail) {
  evidence.steps.push({ name, detail, at: new Date().toISOString() });
  console.log(`• ${name}: ${detail}`);
}

function dbUrl(name) {
  return `postgres://stacks:stacks@127.0.0.1:5432/${name}`;
}

let server = null;
let serverLog = null;
let serverBase = BASE;
let fixture = null;

async function adminQuery(sql) {
  const client = new pg.Client({ connectionString: ADMIN_URL });
  await client.connect();
  try {
    return await client.query(sql);
  } finally {
    await client.end();
  }
}

async function recreateDatabase(name) {
  if (!/^[a-z0-9_]+$/.test(name)) throw new Error(`unsafe database name ${name}`);
  await adminQuery(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
  await adminQuery(`CREATE DATABASE ${name} OWNER stacks`);
}

async function dropDatabase(name) {
  if (!/^[a-z0-9_]+$/.test(name)) return;
  await adminQuery(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
}

async function withDb(url, fn) {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

async function stopServer() {
  if (!server?.pid) return;
  const pid = server.pid;
  try {
    process.kill(-pid, "SIGTERM");
  } catch {
    try {
      server.kill("SIGTERM");
    } catch {
      // already gone
    }
  }
  const started = Date.now();
  const base = serverBase;
  while (Date.now() - started < 15_000) {
    try {
      await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(400) });
    } catch {
      server = null;
      serverLog?.end();
      serverLog = null;
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  try {
    process.kill(-pid, "SIGKILL");
  } catch {
    // already gone
  }
  server = null;
}

async function startServer(databaseUrl, { prod = false, port = PORT, base = BASE } = {}) {
  await stopServer();
  serverBase = base;
  mkdirSync(path.dirname(LOG_PATH), { recursive: true });
  serverLog = createWriteStream(LOG_PATH, { flags: "a" });
  const args = prod
    ? ["start", "-H", "127.0.0.1", "-p", String(port)]
    : ["dev", "-H", "127.0.0.1", "-p", String(port)];
  server = spawn(NEXT_BIN, args, {
    cwd: ROOT,
    env: {
      ...process.env,
      DATABASE_URL: databaseUrl,
      PGSSL: "0",
      PORT: String(port),
      AUTH_URL: base,
      AUTH_SECRET: SECRET,
      AUTH_GOOGLE_ID: prod ? "" : "test-google-client-id",
      AUTH_GOOGLE_SECRET: prod ? "" : "test-google-client-secret-not-real",
      STACKS_AUTH_TEST_OIDC: "1",
      STACKS_AUTH_TEST_ISSUER: fixture.issuer,
      NODE_ENV: prod ? "production" : "development",
    },
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  server.stdout?.pipe(serverLog);
  server.stderr?.pipe(serverLog);
  let exitCode = null;
  server.on("exit", (code) => {
    exitCode = code;
  });
  const started = Date.now();
  while (Date.now() - started < 180_000) {
    if (exitCode !== null) throw new Error(`Next exited ${exitCode}. Log: ${LOG_PATH}`);
    try {
      const response = await fetch(`${base}/api/health`);
      if (response.ok) {
        const body = await response.json();
        if (body.ok && body.db) return;
      }
    } catch {
      // still booting
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Server did not become healthy. Log: ${LOG_PATH}`);
}

async function request(pathname, { cookie = "", origin = ORIGIN, method = "GET", body, base = BASE } = {}) {
  const headers = {};
  if (cookie) headers.cookie = cookie;
  if (origin && method !== "GET") headers.origin = origin;
  if (body !== undefined) headers["content-type"] = "application/json";
  const response = await fetch(`${base}${pathname}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let data = text;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    // keep text
  }
  return { status: response.status, data, text, headers: response.headers };
}

function hashToken(token) {
  return createHash("sha256").update(token).digest("hex");
}

async function userId(subject) {
  return withDb(dbUrl(DB_NAME), async (client) => {
    const result = await client.query(
      `SELECT u.id FROM users u
       JOIN accounts a ON a."userId" = u.id
       WHERE a.provider = 'stacks-test-oidc' AND a."providerAccountId" = $1`,
      [subject],
    );
    return result.rows[0]?.id ?? null;
  });
}

async function shelfRows() {
  return withDb(dbUrl(DB_NAME), (client) =>
    client.query(
      `SELECT id::text, title, owner_id::text, updated_at
       FROM books ORDER BY id`,
    ),
  );
}

async function runConfigChecks() {
  const child = spawn(
    process.execPath,
    [
      "--experimental-strip-types",
      "--disable-warning=ExperimentalWarning",
      "--disable-warning=MODULE_TYPELESS_PACKAGE_JSON",
      path.join(ROOT, "scripts/test/auth-config-check.mts"),
    ],
    { cwd: ROOT, stdio: "inherit" },
  );
  const code = await new Promise((resolve) => child.on("exit", resolve));
  assert.equal(code, 0, "auth-config checks failed");
  log("config", "production test provider stays off; redirects stay on this origin");
}

async function seedLegacy() {
  await withDb(dbUrl(DB_NAME), async (client) => {
    await client.query(`
      CREATE TABLE books (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        title TEXT NOT NULL,
        author TEXT NOT NULL DEFAULT '',
        category TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'owned',
        rating INTEGER,
        notes TEXT NOT NULL DEFAULT '',
        isbn TEXT NOT NULL DEFAULT '',
        year INTEGER,
        publisher TEXT NOT NULL DEFAULT '',
        page_count INTEGER,
        cover_url TEXT NOT NULL DEFAULT '',
        description TEXT NOT NULL DEFAULT '',
        is_example BOOLEAN NOT NULL DEFAULT FALSE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE app_state (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `);
    await client.query(
      `INSERT INTO books (id, title, author, status, created_at, updated_at)
       VALUES ($1, 'Legacy Atlas', 'Old Shelf', 'owned', '2018-01-02T03:04:05.006Z', '2018-01-02T03:04:05.006Z')`,
      [LEGACY_ID],
    );
    await client.query(
      "INSERT INTO app_state (key, value) VALUES ('legacy_label', 'kept'), ('api_token', 'do-not-copy')",
    );
  });
}

function bookBackup(books) {
  return {
    version: "1.0.0",
    createdAt: "2024-01-01T00:00:00.000Z",
    books,
    appState: { examples_seeded: "1" },
    metadata: {
      bookCount: books.length,
      note: "account backup",
      omittedSecretKeys: [],
    },
  };
}

async function signOut(cookie) {
  const csrfResponse = await fetch(`${BASE}/api/auth/csrf`, { headers: { cookie } });
  const csrf = await csrfResponse.json();
  assert.equal(csrfResponse.status, 200);
  assert.ok(csrf.csrfToken);
  const issued = (csrfResponse.headers.getSetCookie?.() ?? [])
    .map((value) => value.split(";")[0])
    .filter(Boolean)
    .join("; ");
  const response = await fetch(`${BASE}/api/auth/signout`, {
    method: "POST",
    redirect: "manual",
    headers: {
      cookie: [cookie, issued].filter(Boolean).join("; "),
      origin: ORIGIN,
      "content-type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ csrfToken: csrf.csrfToken, callbackUrl: "/login" }),
  });
  assert.ok(response.status === 302 || response.status === 200, `signout ${response.status}`);
}

async function shot(page, name) {
  mkdirSync(ARTIFACTS, { recursive: true });
  const dest = path.join(ARTIFACTS, name);
  await page.screenshot({ path: dest, fullPage: true });
  if (existsSync(CURSOR_ARTIFACTS)) await copyFile(dest, path.join(CURSOR_ARTIFACTS, name));
  log("screenshot", dest);
}

async function browserPass() {
  process.env.DISPLAY ||= ":1";
  const browser = await chromium.launch({ channel: "chrome", headless: false, args: ["--no-sandbox"] });
  try {
    for (const [name, viewport, mobile] of [
      ["desktop", { width: 1280, height: 800 }, false],
      ["mobile", { width: 390, height: 844 }, true],
    ]) {
      const context = await browser.newContext({
        viewport,
        deviceScaleFactor: mobile ? 2 : 1,
        isMobile: mobile,
        hasTouch: mobile,
      });
      const page = await context.newPage();
      page.setDefaultTimeout(30_000);
      await page.goto(BASE, { waitUntil: "domcontentloaded" });
      await page.getByTestId("continue-google").waitFor();
      await page.getByTestId("continue-test-alice").waitFor();
      await page.getByTestId("test-oidc-note").waitFor();
      assert.equal(await page.getByTestId("auth-unconfigured").count(), 0);
      await shot(page, `${name}_01_login.png`);
      await page.getByTestId(name === "desktop" ? "continue-test-alice" : "continue-test-bob").click();
      await page.getByTestId("signed-in-as").waitFor();
      const who = await page.getByTestId("signed-in-as").innerText();
      if (name === "desktop") {
        assert.match(who, /alice@example.test/);
        await page.getByRole("heading", { name: "Alpha Private" }).waitFor();
        assert.equal(await page.getByRole("heading", { name: "Beta Private" }).count(), 0);
        assert.equal(await page.getByTestId("load-error").count(), 0);
        const crookedCard = page.getByTestId("book-card").filter({ hasText: "Crooked Check" });
        await crookedCard.waitFor();
        assert.match(await crookedCard.innerText(), /978-045152493-6/);
        await crookedCard.click();
        await page.getByTestId("save-book").click();
        await page.getByTestId("form-error").waitFor();
        assert.match(await page.getByTestId("form-error").innerText(), /valid ISBN-10 or ISBN-13/);
        await page.getByRole("button", { name: "Close" }).click();
        await page.getByTestId("save-book").waitFor({ state: "hidden" });
        await page.getByTestId("add-book").click();
        await page.getByTestId("title-input").fill("Should Not Save");
        await page.getByTestId("isbn-input").fill("9780451524936");
        await page.getByTestId("save-book").click();
        await page.getByTestId("form-error").waitFor();
        assert.match(await page.getByTestId("form-error").innerText(), /valid ISBN-10 or ISBN-13/);
        await page.getByRole("button", { name: "Close" }).click();
        await page.getByTestId("save-book").waitFor({ state: "hidden" });
        assert.equal(await page.getByRole("heading", { name: "Should Not Save" }).count(), 0);
        assert.equal(await page.getByRole("heading", { name: "Crooked Check" }).count(), 1);
      } else {
        assert.match(who, /bob@example.test/);
        await page.getByRole("heading", { name: "Beta Private" }).waitFor();
        assert.equal(await page.getByRole("heading", { name: "Alpha Private" }).count(), 0);
      }
      await shot(page, `${name}_02_signed_in.png`);
      await page.getByTestId("shelf-menu").click();
      await page.getByTestId("sign-out").click();
      await page.getByTestId("continue-test-alice").waitFor();
      await shot(page, `${name}_03_signed_out.png`);
      await context.close();
      log("browser", `${name} login, shelf, and sign-out`);
    }
  } finally {
    await browser.close();
  }
}

async function main() {
  await runConfigChecks();
  await recreateDatabase(DB_NAME);
  await seedLegacy();
  log("legacy-seed", "ownerless book inserted before the additive migration");

  fixture = await startOidcFixture(0);
  log("fixture", `${fixture.issuer} is a local OIDC fixture, not accounts.google.com`);
  await startServer(dbUrl(DB_NAME));
  log("server", BASE);

  const migrated = await withDb(dbUrl(DB_NAME), (client) =>
    client.query("SELECT title, owner_id FROM books WHERE id = $1", [LEGACY_ID]),
  );
  assert.equal(migrated.rows[0].title, "Legacy Atlas");
  assert.equal(migrated.rows[0].owner_id, null);
  log("migration", "legacy book kept and owner_id is null");

  const home = await fetch(BASE, { redirect: "manual" });
  assert.ok(home.status >= 300 && home.status < 400);
  assert.match(home.headers.get("location") ?? "", /\/login/);
  const login = await fetch(`${BASE}/login`);
  const loginHtml = await login.text();
  assert.equal(loginHtml.includes("Legacy Atlas"), false);
  assert.equal(loginHtml.includes("Alpha Private"), false);
  log("anonymous-page", "home redirects to login and does not render shelf titles");

  for (const [method, pathname, body] of [
    ["GET", "/api/books", undefined],
    ["GET", `/api/books/${LEGACY_ID}`, undefined],
    ["POST", "/api/books", { title: "Nope" }],
    ["PATCH", `/api/books/${LEGACY_ID}`, { title: "Nope" }],
    ["DELETE", `/api/books/${LEGACY_ID}`, undefined],
    ["DELETE", "/api/books/examples", undefined],
    ["GET", "/api/backup", undefined],
    ["POST", "/api/backup/validate", { version: "1.0.0" }],
    ["POST", "/api/backup/restore", { confirm: true, backup: {} }],
    ["GET", "/api/lookup?isbn=9780451524935", undefined],
  ]) {
    const result = await request(pathname, { method, body });
    assert.equal(result.status, 401, `${method} ${pathname} -> ${result.status} ${result.text}`);
  }
  log("anonymous-api", "list, detail, write, backup, lookup, and examples are 401");

  const aliceFirst = await oidcSignIn({ base: BASE, subject: "alice" });
  assert.ok(aliceFirst.sessionToken, `alice sign-in hops ${aliceFirst.hops.join(" -> ")}`);
  assert.match(aliceFirst.sessionName, /authjs\.session-token/);
  assert.doesNotMatch(aliceFirst.sessionName, /__Secure-/);
  const aliceAgain = await oidcSignIn({
    base: BASE,
    subject: "alice",
    email: "alice.changed@example.test",
  });
  assert.ok(aliceAgain.sessionToken);
  const accounts = await withDb(dbUrl(DB_NAME), (client) =>
    client.query(
      `SELECT a."providerAccountId", a.access_token, a.refresh_token, a.id_token, u.email, u."emailVerified"
       FROM accounts a JOIN users u ON u.id = a."userId"
       WHERE a.provider = 'stacks-test-oidc' AND a."providerAccountId" = 'alice'`,
    ),
  );
  assert.equal(accounts.rows.length, 1);
  assert.equal(accounts.rows[0].access_token, null);
  assert.equal(accounts.rows[0].refresh_token, null);
  assert.equal(accounts.rows[0].id_token, null);
  assert.ok(accounts.rows[0].emailVerified);
  const sessionRow = await withDb(dbUrl(DB_NAME), (client) =>
    client.query(`SELECT "sessionToken" FROM sessions WHERE "sessionToken" = $1`, [
      hashToken(aliceAgain.sessionToken),
    ]),
  );
  assert.equal(sessionRow.rows.length, 1);
  assert.notEqual(sessionRow.rows[0].sessionToken, aliceAgain.sessionToken);
  log("idempotent", "two alice sign-ins, one account, tokens discarded, session stored as a hash");

  const beforeCarol = await withDb(dbUrl(DB_NAME), (client) =>
    client.query("SELECT COUNT(*)::int AS n FROM users"),
  );
  const carol = await oidcSignIn({
    base: BASE,
    subject: "carol",
    email: "alice@example.test",
  });
  assert.equal(carol.sessionToken, "");
  const afterCarol = await withDb(dbUrl(DB_NAME), (client) =>
    client.query("SELECT COUNT(*)::int AS n FROM users"),
  );
  assert.equal(Number(afterCarol.rows[0].n), Number(beforeCarol.rows[0].n));
  log("email-collision", "same verified email and a different subject did not create or link an account");

  for (const fault of ["exp", "aud", "sig", "unverified", "nosub", "iss", "clientsub"]) {
    const failed = await oidcSignIn({ base: BASE, subject: `fault-${fault}`, fault });
    assert.equal(failed.sessionToken, "", fault);
  }
  const faultUsers = await withDb(dbUrl(DB_NAME), (client) =>
    client.query(
      `SELECT COUNT(*)::int AS n FROM accounts WHERE "providerAccountId" LIKE 'fault-%' OR "providerAccountId" = $1`,
      ["stacks-test-client"],
    ),
  );
  assert.equal(Number(faultUsers.rows[0].n), 0);
  log("oidc-checks", "expired, wrong audience, bad signature, unverified, missing subject, and Google issuer were rejected");

  const bob = await oidcSignIn({ base: BASE, subject: "bob" });
  assert.ok(bob.sessionToken);
  const aliceId = await userId("alice");
  const bobId = await userId("bob");
  assert.ok(aliceId && bobId && aliceId !== bobId);
  await withDb(dbUrl(DB_NAME), async (client) => {
    await client.query(
      "INSERT INTO user_settings (user_id, key, value) VALUES ($1, 'examples_seeded', '1'), ($2, 'examples_seeded', '1')",
      [aliceId, bobId],
    );
  });

  const evil = await request("/api/books", {
    cookie: aliceAgain.cookieHeader,
    method: "POST",
    origin: "https://evil.example",
    body: { title: "Cross Site" },
  });
  assert.equal(evil.status, 403);
  const missingOrigin = await request("/api/books", {
    cookie: aliceAgain.cookieHeader,
    method: "POST",
    origin: "",
    body: { title: "No Origin" },
  });
  assert.equal(missingOrigin.status, 403);

  const created = await request("/api/books", {
    cookie: aliceAgain.cookieHeader,
    method: "POST",
    body: {
      title: "Alpha Private",
      author: "Ada",
      status: "reading",
      ownerId: bobId,
      rating: 4,
    },
    headersNote: "owner ignored",
  });
  assert.equal(created.status, 201, JSON.stringify(created.data));
  const alpha = created.data.book;
  const owner = await withDb(dbUrl(DB_NAME), (client) =>
    client.query("SELECT owner_id::text FROM books WHERE id = $1", [alpha.id]),
  );
  assert.equal(owner.rows[0].owner_id, aliceId);

  const bobBook = await request("/api/books", {
    cookie: bob.cookieHeader,
    method: "POST",
    body: { title: "Beta Private", author: "Grace", status: "read" },
  });
  assert.equal(bobBook.status, 201, JSON.stringify(bobBook.data));
  const beta = bobBook.data.book;

  const aliceList = await request("/api/books?status=reading&q=Alpha", { cookie: aliceAgain.cookieHeader });
  assert.equal(aliceList.status, 200);
  assert.match(aliceList.headers.get("cache-control") ?? "", /private/);
  assert.match(aliceList.headers.get("cache-control") ?? "", /no-store/);
  assert.equal(aliceList.data.stats.filtered, 1);
  assert.equal(aliceList.data.stats.byStatus.reading, 1);
  assert.equal(aliceList.data.books.some((book) => book.title === "Beta Private"), false);
  assert.equal(aliceList.data.books.some((book) => book.title === "Legacy Atlas"), false);
  const aliceAll = await request("/api/books", { cookie: aliceAgain.cookieHeader });
  assert.equal(aliceAll.data.stats.total >= 1, true);
  assert.equal(aliceAll.data.books.some((book) => book.title === "Beta Private"), false);

  const bobSeesAlpha = await request(`/api/books/${alpha.id}`, { cookie: bob.cookieHeader });
  assert.equal(bobSeesAlpha.status, 404);
  const bobPatch = await request(`/api/books/${alpha.id}`, {
    cookie: bob.cookieHeader,
    method: "PATCH",
    body: { title: "Stolen", ownerId: bobId },
  });
  assert.equal(bobPatch.status, 404);
  const bobDelete = await request(`/api/books/${alpha.id}`, {
    cookie: bob.cookieHeader,
    method: "DELETE",
  });
  assert.equal(bobDelete.status, 404);
  const stillAlpha = await request(`/api/books/${alpha.id}`, { cookie: aliceAgain.cookieHeader });
  assert.equal(stillAlpha.status, 200);
  assert.equal(stillAlpha.data.book.title, "Alpha Private");

  const forgedHeader = await fetch(`${BASE}/api/books/${beta.id}`, {
    headers: { cookie: aliceAgain.cookieHeader, "x-user-id": bobId },
  });
  assert.equal(forgedHeader.status, 404);
  log("isolation", "bob cannot read, edit, or delete alice; forged owner id and header are ignored");

  const aliceExport = await request("/api/backup", { cookie: aliceAgain.cookieHeader });
  const bobExport = await request("/api/backup", { cookie: bob.cookieHeader });
  assert.equal(aliceExport.status, 200);
  assert.equal(JSON.stringify(aliceExport.data).includes("Beta Private"), false);
  assert.equal(JSON.stringify(aliceExport.data).includes("Legacy Atlas"), false);
  assert.equal(JSON.stringify(aliceExport.data).includes("sessionToken"), false);
  assert.equal(JSON.stringify(aliceExport.data).includes("providerAccountId"), false);
  assert.equal(JSON.stringify(aliceExport.data).includes(SECRET), false);
  assert.equal(JSON.stringify(bobExport.data).includes("Alpha Private"), false);
  log("export", "each backup contains only that account");

  const beforeRestore = await shelfRows();
  const forgedOwner = structuredClone(aliceExport.data);
  forgedOwner.books[0].ownerId = bobId;
  const rejectedOwner = await request("/api/backup/restore", {
    cookie: aliceAgain.cookieHeader,
    method: "POST",
    body: { confirm: true, replace: true, backup: forgedOwner },
  });
  assert.equal(rejectedOwner.status, 400);
  const stolenId = structuredClone(aliceExport.data);
  stolenId.books[0].id = beta.id;
  stolenId.metadata.bookCount = stolenId.books.length;
  const rejectedId = await request("/api/backup/restore", {
    cookie: aliceAgain.cookieHeader,
    method: "POST",
    body: { confirm: true, replace: true, backup: stolenId },
  });
  assert.notEqual(rejectedId.status, 200, JSON.stringify(rejectedId.data));
  assert.deepEqual((await shelfRows()).rows, beforeRestore.rows);
  log("forged-backup", "owner field and another account's book id did not change either shelf");

  const edited = await request(`/api/books/${alpha.id}`, {
    cookie: aliceAgain.cookieHeader,
    method: "PATCH",
    body: { title: "Alpha Edited", author: "Ada", status: "reading", rating: 5 },
  });
  assert.equal(edited.status, 200);
  const restored = await request("/api/backup/restore", {
    cookie: aliceAgain.cookieHeader,
    method: "POST",
    body: { confirm: true, replace: true, backup: aliceExport.data },
  });
  assert.equal(restored.status, 200, JSON.stringify(restored.data));
  const afterRestore = await shelfRows();
  const bobAfter = afterRestore.rows.find((row) => row.id === beta.id);
  const bobBefore = beforeRestore.rows.find((row) => row.id === beta.id);
  assert.equal(bobAfter.title, bobBefore.title);
  assert.equal(bobAfter.owner_id, bobId);
  assert.equal(new Date(bobAfter.updated_at).toISOString(), new Date(bobBefore.updated_at).toISOString());
  const legacyAfter = afterRestore.rows.find((row) => row.id === LEGACY_ID);
  assert.equal(legacyAfter.owner_id, null);
  const alphaAgain = await request(`/api/books/${alpha.id}`, { cookie: aliceAgain.cookieHeader });
  assert.equal(alphaAgain.data.book.title, "Alpha Private");
  log("restore", "alice restore rolled her shelf back and left bob and the legacy book unchanged");

  const deleted = await request(`/api/books/${alpha.id}`, {
    cookie: aliceAgain.cookieHeader,
    method: "DELETE",
  });
  assert.equal(deleted.status, 200);
  const gone = await request(`/api/books/${alpha.id}`, { cookie: aliceAgain.cookieHeader });
  assert.equal(gone.status, 404);
  const recreated = await request("/api/books", {
    cookie: aliceAgain.cookieHeader,
    method: "POST",
    body: { title: "Alpha Private", author: "Ada", status: "reading", rating: 4 },
  });
  assert.equal(recreated.status, 201);

  const redirect = await oidcSignIn({
    base: BASE,
    subject: "alice",
    callbackUrl: "https://evil.example/phish",
  });
  assert.ok(redirect.hops.every((hop) => !hop.includes("evil.example")));
  const protocolRelative = await oidcSignIn({
    base: BASE,
    subject: "alice",
    callbackUrl: "//evil.example",
  });
  assert.ok(protocolRelative.hops.every((hop) => !hop.includes("evil.example")));
  log("redirect", "off-site callback URLs stayed on this origin");

  const usersBeforeAssign = await userId("alice");
  const dry = spawn(
    process.execPath,
    [
      "--experimental-strip-types",
      "--disable-warning=ExperimentalWarning",
      "--disable-warning=MODULE_TYPELESS_PACKAGE_JSON",
      path.join(ROOT, "scripts/legacy/assign-owner.mts"),
    ],
    {
      cwd: ROOT,
      env: {
        ...process.env,
        DATABASE_URL: dbUrl(DB_NAME),
        NODE_ENV: "development",
        STACKS_LEGACY_OWNER_SUBJECT: "alice",
        STACKS_LEGACY_OWNER_PROVIDER: "stacks-test-oidc",
      },
    },
  );
  let dryOut = "";
  dry.stdout.on("data", (chunk) => {
    dryOut += chunk;
  });
  const dryCode = await new Promise((resolve) => dry.on("exit", resolve));
  assert.equal(dryCode, 0, dryOut);
  assert.match(dryOut, /STACKS_LEGACY_PLAN/);
  const stillNull = await withDb(dbUrl(DB_NAME), (client) =>
    client.query("SELECT owner_id FROM books WHERE id = $1", [LEGACY_ID]),
  );
  assert.equal(stillNull.rows[0].owner_id, null);
  assert.equal(await userId("alice"), usersBeforeAssign);

  const remote = spawn(
    process.execPath,
    [
      "--experimental-strip-types",
      "--disable-warning=ExperimentalWarning",
      "--disable-warning=MODULE_TYPELESS_PACKAGE_JSON",
      path.join(ROOT, "scripts/legacy/assign-owner.mts"),
    ],
    {
      cwd: ROOT,
      env: {
        ...process.env,
        DATABASE_URL: "postgres://stacks:stacks@stacks-production.up.railway.app:5432/railway",
        STACKS_LEGACY_OWNER_SUBJECT: "alice",
      },
    },
  );
  let remoteErr = "";
  remote.stderr.on("data", (chunk) => {
    remoteErr += chunk;
  });
  const remoteCode = await new Promise((resolve) => remote.on("exit", resolve));
  assert.equal(remoteCode, 2);
  assert.match(remoteErr, /Refused before connecting/);

  await withDb(dbUrl(DB_NAME), (client) =>
    client.query(`UPDATE users SET "emailVerified" = NULL WHERE id = $1`, [bobId]),
  );
  const unverified = spawn(
    process.execPath,
    [
      "--experimental-strip-types",
      "--disable-warning=ExperimentalWarning",
      "--disable-warning=MODULE_TYPELESS_PACKAGE_JSON",
      path.join(ROOT, "scripts/legacy/assign-owner.mts"),
      "--apply",
    ],
    {
      cwd: ROOT,
      env: {
        ...process.env,
        DATABASE_URL: dbUrl(DB_NAME),
        NODE_ENV: "development",
        STACKS_LEGACY_ASSIGN_APPLY: "yes",
        STACKS_LEGACY_OWNER_SUBJECT: "bob",
        STACKS_LEGACY_OWNER_PROVIDER: "stacks-test-oidc",
      },
    },
  );
  const unverifiedCode = await new Promise((resolve) => unverified.on("exit", resolve));
  assert.equal(unverifiedCode, 1);
  const stillUnassigned = await withDb(dbUrl(DB_NAME), (client) =>
    client.query("SELECT owner_id FROM books WHERE id = $1", [LEGACY_ID]),
  );
  assert.equal(stillUnassigned.rows[0].owner_id, null);
  await withDb(dbUrl(DB_NAME), (client) =>
    client.query(`UPDATE users SET "emailVerified" = NOW() WHERE id = $1`, [bobId]),
  );

  const applied = spawn(
    process.execPath,
    [
      "--experimental-strip-types",
      "--disable-warning=ExperimentalWarning",
      "--disable-warning=MODULE_TYPELESS_PACKAGE_JSON",
      path.join(ROOT, "scripts/legacy/assign-owner.mts"),
      "--apply",
    ],
    {
      cwd: ROOT,
      env: {
        ...process.env,
        DATABASE_URL: dbUrl(DB_NAME),
        NODE_ENV: "development",
        STACKS_LEGACY_ASSIGN_APPLY: "yes",
        STACKS_LEGACY_OWNER_SUBJECT: "alice",
        STACKS_LEGACY_OWNER_PROVIDER: "stacks-test-oidc",
        STACKS_LEGACY_OWNER_EMAIL: "alice@example.test",
      },
    },
  );
  let appliedOut = "";
  applied.stdout.on("data", (chunk) => {
    appliedOut += chunk;
  });
  const appliedCode = await new Promise((resolve) => applied.on("exit", resolve));
  assert.equal(appliedCode, 0, appliedOut);
  const legacyOwner = await withDb(dbUrl(DB_NAME), async (client) => {
    const book = await client.query("SELECT owner_id::text FROM books WHERE id = $1", [LEGACY_ID]);
    const state = await client.query("SELECT key, value FROM app_state ORDER BY key");
    const copied = await client.query(
      "SELECT key, value FROM user_settings WHERE user_id = $1 AND key = 'legacy_label'",
      [aliceId],
    );
    const secret = await client.query(
      "SELECT key FROM user_settings WHERE user_id = $1 AND key = 'api_token'",
      [aliceId],
    );
    return { book, state, copied, secret };
  });
  assert.equal(legacyOwner.book.rows[0].owner_id, aliceId);
  assert.deepEqual(
    legacyOwner.state.rows.map((row) => row.key),
    ["api_token", "legacy_label"],
  );
  assert.equal(legacyOwner.state.rows.find((row) => row.key === "api_token").value, "do-not-copy");
  assert.equal(legacyOwner.copied.rows[0].value, "kept");
  assert.equal(legacyOwner.secret.rows.length, 0);
  const bobLegacy = await request("/api/books", { cookie: bob.cookieHeader });
  assert.equal(bobLegacy.data.books.some((book) => book.title === "Legacy Atlas"), false);
  const aliceLegacy = await request(`/api/books/${LEGACY_ID}`, { cookie: aliceAgain.cookieHeader });
  assert.equal(aliceLegacy.status, 200);
  log("assign", "dry-run wrote nothing; unverified bob was refused; alice received only the ownerless rows");

  const casey = await oidcSignIn({ base: BASE, subject: "casey" });
  const caseyShelf = await request("/api/books", { cookie: casey.cookieHeader });
  assert.equal(caseyShelf.data.stats.total, 3);
  assert.equal(caseyShelf.data.books.some((book) => book.title === "Alpha Private"), false);
  const removed = await request("/api/books/examples", {
    cookie: casey.cookieHeader,
    method: "DELETE",
  });
  assert.equal(removed.status, 200);
  assert.equal(removed.data.removed, 3);
  const bobStill = await request(`/api/books/${beta.id}`, { cookie: bob.cookieHeader });
  assert.equal(bobStill.status, 200);
  log("examples", "a new account seeds only its own examples and cannot delete another shelf");

  await signOut(aliceAgain.cookieHeader);
  const afterOut = await request("/api/books", { cookie: aliceAgain.cookieHeader });
  assert.equal(afterOut.status, 401);
  const hashed = hashToken(aliceAgain.sessionToken);
  const sessionGone = await withDb(dbUrl(DB_NAME), (client) =>
    client.query(`SELECT 1 FROM sessions WHERE "sessionToken" = $1`, [hashed]),
  );
  assert.equal(sessionGone.rows.length, 0);

  const fresh = await oidcSignIn({ base: BASE, subject: "alice" });
  await withDb(dbUrl(DB_NAME), (client) =>
    client.query(`UPDATE sessions SET expires = '2000-01-01T00:00:00.000Z' WHERE "sessionToken" = $1`, [
      hashToken(fresh.sessionToken),
    ]),
  );
  const expired = await request("/api/books", { cookie: fresh.cookieHeader });
  assert.equal(expired.status, 401);
  const forged = await request("/api/books", {
    cookie: "authjs.session-token=00000000-0000-4000-8000-000000000000",
  });
  assert.equal(forged.status, 401);
  log("session", "sign-out and an expired session are denied");

  const sessionView = await request("/api/auth/session", { cookie: bob.cookieHeader });
  assert.equal(JSON.stringify(sessionView.data).includes("sessionToken"), false);
  assert.equal(JSON.stringify(sessionView.data).includes("access_token"), false);
  const providers = await request("/api/auth/providers");
  assert.equal(providers.data.google?.id, "google");
  assert.equal(providers.data["stacks-test-oidc"]?.id, "stacks-test-oidc");
  assert.equal(JSON.stringify(providers.data).includes("test-google-client-secret-not-real"), false);
  assert.equal(JSON.stringify(providers.data).includes(TEST_PLACEHOLDER()), false);
  log("providers", "google and the local fixture are separate; client secrets are not in the provider list");

  const isbnSession = await oidcSignIn({ base: BASE, subject: "alice" });
  const crookedId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  await withDb(dbUrl(DB_NAME), (client) =>
    client.query(
      `INSERT INTO books (id, title, author, isbn, owner_id, created_at, updated_at)
       VALUES ($1, 'Crooked Check', 'Typo', '9780451524936', $2, '2016-01-02T03:04:05.006Z', '2016-01-02T03:04:05.006Z')`,
      [crookedId, aliceId],
    ),
  );
  const loadedCrooked = await request("/api/books", { cookie: isbnSession.cookieHeader });
  assert.equal(loadedCrooked.status, 200, JSON.stringify(loadedCrooked.data));
  const crookedRow = loadedCrooked.data.books.find((book) => book.id === crookedId);
  assert.ok(crookedRow);
  assert.equal(crookedRow.isbn, "9780451524936");
  const oneCrooked = await request(`/api/books/${crookedId}`, { cookie: isbnSession.cookieHeader });
  assert.equal(oneCrooked.status, 200);
  assert.equal(oneCrooked.data.book.title, "Crooked Check");
  assert.equal(oneCrooked.data.book.isbn, "9780451524936");

  const badCreate = await request("/api/books", {
    cookie: isbnSession.cookieHeader,
    method: "POST",
    body: { title: "Should Not Save", isbn: "9780451524936" },
  });
  assert.equal(badCreate.status, 400, JSON.stringify(badCreate.data));
  assert.match(badCreate.data.error, /valid ISBN-10 or ISBN-13/);
  const absent = await request("/api/books?q=Should%20Not%20Save", {
    cookie: isbnSession.cookieHeader,
  });
  assert.equal(
    absent.data.books.some((book) => book.title === "Should Not Save"),
    false,
  );

  const fromTen = await request("/api/books", {
    cookie: isbnSession.cookieHeader,
    method: "POST",
    body: { title: "From Ten", isbn: "0-451-52493-4" },
  });
  assert.equal(fromTen.status, 201, JSON.stringify(fromTen.data));
  assert.equal(fromTen.data.book.isbn, "9780451524935");

  const already = await request("/api/books", {
    cookie: isbnSession.cookieHeader,
    method: "POST",
    body: { title: "Already Thirteen", isbn: "9780141439518" },
  });
  assert.equal(already.status, 201, JSON.stringify(already.data));
  assert.equal(already.data.book.isbn, "9780141439518");

  const blank = await request("/api/books", {
    cookie: isbnSession.cookieHeader,
    method: "POST",
    body: { title: "No Isbn", isbn: "" },
  });
  assert.equal(blank.status, 201, JSON.stringify(blank.data));
  assert.equal(blank.data.book.isbn, "");

  const badEdit = await request(`/api/books/${already.data.book.id}`, {
    cookie: isbnSession.cookieHeader,
    method: "PATCH",
    body: { isbn: "9780141439519" },
  });
  assert.equal(badEdit.status, 400, JSON.stringify(badEdit.data));
  assert.match(badEdit.data.error, /valid ISBN-10 or ISBN-13/);
  const stillThirteen = await request(`/api/books/${already.data.book.id}`, {
    cookie: isbnSession.cookieHeader,
  });
  assert.equal(stillThirteen.data.book.isbn, "9780141439518");
  assert.equal(stillThirteen.data.book.title, "Already Thirteen");

  const editedTen = await request(`/api/books/${fromTen.data.book.id}`, {
    cookie: isbnSession.cookieHeader,
    method: "PATCH",
    body: { isbn: "0141439513" },
  });
  assert.equal(editedTen.status, 200, JSON.stringify(editedTen.data));
  assert.equal(editedTen.data.book.isbn, "9780141439518");

  const editedSame = await request(`/api/books/${already.data.book.id}`, {
    cookie: isbnSession.cookieHeader,
    method: "PATCH",
    body: { title: "Already Thirteen", isbn: "978-0-141-43951-8" },
  });
  assert.equal(editedSame.status, 200, JSON.stringify(editedSame.data));
  assert.equal(editedSame.data.book.isbn, "9780141439518");

  const cleared = await request(`/api/books/${fromTen.data.book.id}`, {
    cookie: isbnSession.cookieHeader,
    method: "PATCH",
    body: { isbn: "   " },
  });
  assert.equal(cleared.status, 200, JSON.stringify(cleared.data));
  assert.equal(cleared.data.book.isbn, "");

  const blockedRename = await request(`/api/books/${crookedId}`, {
    cookie: isbnSession.cookieHeader,
    method: "PATCH",
    body: { title: "Crooked Renamed" },
  });
  assert.equal(blockedRename.status, 400, JSON.stringify(blockedRename.data));
  const stillCrooked = await request(`/api/books/${crookedId}`, {
    cookie: isbnSession.cookieHeader,
  });
  assert.equal(stillCrooked.data.book.title, "Crooked Check");
  assert.equal(stillCrooked.data.book.isbn, "9780451524936");
  log(
    "isbn",
    "invalid check digits rejected on create and edit; ISBN-10 stored as ISBN-13; valid ISBN-13 unchanged; a stored invalid ISBN still loads",
  );

  await browserPass();

  await stopServer();
  if (!existsSync(path.join(ROOT, ".next", "BUILD_ID"))) {
    throw new Error("Production backdoor check needs npm run build first");
  }
  await recreateDatabase(PROD_DB);
  await startServer(dbUrl(PROD_DB), { prod: true, port: PROD_PORT, base: PROD_BASE });
  const prodLogin = await fetch(`${PROD_BASE}/login`);
  const prodHtml = await prodLogin.text();
  assert.equal(prodHtml.includes("continue-test-alice"), false);
  assert.equal(prodHtml.includes("stacks-test-oidc"), false);
  assert.match(prodHtml, /auth-unconfigured|Google sign-in is not configured/);
  const prodBooks = await fetch(`${PROD_BASE}/api/books`);
  assert.equal(prodBooks.status, 401);
  const prodSignIn = await fetch(`${PROD_BASE}/api/auth/signin/stacks-test-oidc`, {
    method: "POST",
    redirect: "manual",
  });
  const prodLocation = prodSignIn.headers.get("location") ?? "";
  assert.equal(prodLocation.includes(fixture.issuer), false);
  assert.equal((prodSignIn.headers.get("set-cookie") ?? "").includes("session-token"), false);
  const prodProviders = await fetch(`${PROD_BASE}/api/auth/providers`);
  const prodProviderJson = await prodProviders.json();
  assert.equal(prodProviderJson["stacks-test-oidc"], undefined);
  assert.equal(prodProviderJson.google, undefined);
  log("production", "next start ignores the test fixture flag and serves no shelf");

  mkdirSync(ARTIFACTS, { recursive: true });
  writeFileSync(path.join(ARTIFACTS, "evidence.json"), JSON.stringify(evidence, null, 2));
  if (existsSync(CURSOR_ARTIFACTS)) {
    writeFileSync(path.join(CURSOR_ARTIFACTS, "auth-evidence.json"), JSON.stringify(evidence, null, 2));
  }
}

function TEST_PLACEHOLDER() {
  return "stacks-test-secret";
}

try {
  await main();
  console.log("\nPASS auth-isolation");
} catch (error) {
  console.error("\nFAIL auth-isolation");
  console.error(error);
  try {
    console.error(readFileSync(LOG_PATH, "utf8").split("\n").slice(-80).join("\n"));
  } catch {
    // no log
  }
  process.exitCode = 1;
} finally {
  await stopServer();
  if (fixture) await fixture.close().catch(() => undefined);
  await dropDatabase(DB_NAME).catch((error) => console.error("drop", error.message));
  await dropDatabase(PROD_DB).catch((error) => console.error("drop prod", error.message));
}
