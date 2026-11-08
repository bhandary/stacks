#!/usr/bin/env node
/**
 * Disposable-database proof for Stacks backup/restore.
 * Creates two throwaway databases, never the default `stacks` database.
 */
import { spawn } from "node:child_process";
import { strict as assert } from "node:assert";
import { createWriteStream, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { copyFile, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { chromium } from "playwright";
import { startOidcFixture } from "./oidc-fixture.mjs";
import { oidcSignIn } from "./oidc-flow.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const PORT = 43182;
const BASE = `http://localhost:${PORT}`;
const ADMIN_URL = "postgres://stacks:stacks@127.0.0.1:5432/postgres";
const SRC_DB = "stacks_bk_src_4b28";
const DST_DB = "stacks_bk_dst_4b28";
const NEXT_BIN = path.join(ROOT, "node_modules", ".bin", "next");
const ARTIFACTS = path.join(ROOT, "artifacts", "backup-restore");
const CURSOR_ARTIFACTS = "/opt/cursor/artifacts";
const LOG_PATH = "/tmp/stacks-backup-next.log";
const MAX_BACKUP_BYTES = 8 * 1024 * 1024;
const AUTH_SECRET = "backup-test-auth-secret-not-for-production";

const BOOK_FIELDS = [
  "id",
  "title",
  "author",
  "category",
  "status",
  "rating",
  "notes",
  "isbn",
  "year",
  "publisher",
  "pageCount",
  "coverUrl",
  "description",
  "isExample",
  "createdAt",
  "updatedAt",
];

const BOOK_A = {
  id: "11111111-1111-4111-8111-111111111111",
  title: "Window Seat Atlas",
  author: "Ada Lovelace",
  category: "Travel",
  status: "reading",
  rating: 4,
  notes: "A token of appreciation\nand a second line",
  isbn: "0-451-52493-4",
  year: 42,
  publisher: "O'Reilly",
  pageCount: 0,
  coverUrl: "https://example.com/covers/atlas.jpg",
  description: "Notes about the shelf.",
  isExample: false,
  createdAt: "2020-05-06T07:08:09.010Z",
  updatedAt: "2021-06-07T08:09:10.011Z",
};

const BOOK_B = {
  id: "22222222-2222-4222-8222-222222222222",
  title: "Empty Fields",
  author: "",
  category: "",
  status: "read",
  rating: null,
  notes: "",
  isbn: "",
  year: null,
  publisher: "",
  pageCount: null,
  coverUrl: "",
  description: "",
  isExample: true,
  createdAt: "2019-01-02T03:04:05.006Z",
  updatedAt: "2019-01-02T03:04:05.006Z",
};

const evidence = { steps: [], base: BASE, databases: [SRC_DB, DST_DB] };

function log(name, detail) {
  evidence.steps.push({ name, detail, at: new Date().toISOString() });
  console.log(`• ${name}: ${detail}`);
}

function dbUrl(name) {
  return `postgres://stacks:stacks@127.0.0.1:5432/${name}`;
}

function canonical(backup) {
  return {
    books: backup.books
      .map((book) => {
        const next = {};
        for (const field of BOOK_FIELDS) next[field] = book[field];
        return next;
      })
      .sort((a, b) => a.id.localeCompare(b.id)),
    appState: backup.appState,
  };
}

function emptyBackup() {
  return {
    version: "1.0.0",
    createdAt: "2024-01-01T00:00:00.000Z",
    books: [],
    appState: {},
    metadata: { bookCount: 0, note: "empty test backup", omittedSecretKeys: [] },
  };
}

let server = null;
let serverLog = null;
let fixture = null;
let auth = { cookieHeader: "", sessionName: "authjs.session-token", sessionToken: "" };
let ownerId = null;

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

async function seedShelf(databaseName) {
  await withDb(dbUrl(databaseName), async (client) => {
    const books = [BOOK_A, BOOK_B];
    for (const book of books) {
      await client.query(
        `INSERT INTO books (
          id, title, author, category, status, rating, notes, isbn, year,
          publisher, page_count, cover_url, description, is_example, created_at, updated_at,
          owner_id
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
        [
          book.id,
          book.title,
          book.author,
          book.category,
          book.status,
          book.rating,
          book.notes,
          book.isbn,
          book.year,
          book.publisher,
          book.pageCount,
          book.coverUrl,
          book.description,
          book.isExample,
          book.createdAt,
          book.updatedAt,
          ownerId,
        ],
      );
    }
    await client.query(
      `INSERT INTO user_settings (user_id, key, value)
       VALUES ($1, 'examples_seeded', '1'), ($1, 'shelf_label', 'Window seat'), ($1, 'api_token', 'hunter2')`,
      [ownerId],
    );
    await client.query(
      `INSERT INTO books (id, title, author, created_at, updated_at)
       VALUES ('99999999-9999-4999-8999-999999999999', 'Legacy Unassigned', '', '2017-01-02T03:04:05.006Z', '2017-01-02T03:04:05.006Z')
       ON CONFLICT (id) DO NOTHING`,
    );
    await client.query(
      "INSERT INTO app_state (key, value) VALUES ('legacy_label', 'leave-me') ON CONFLICT (key) DO NOTHING",
    );
  });
}

async function assertLegacyRemains() {
  const row = await withDb(dbUrlFromServer(), (client) =>
    client.query(
      "SELECT title, owner_id FROM books WHERE id = '99999999-9999-4999-8999-999999999999'",
    ),
  );
  assert.equal(row.rows[0]?.title, "Legacy Unassigned");
  assert.equal(row.rows[0]?.owner_id, null);
  const state = await withDb(dbUrlFromServer(), (client) =>
    client.query("SELECT value FROM app_state WHERE key = 'legacy_label'"),
  );
  assert.equal(state.rows[0]?.value, "leave-me");
}

async function signInCurrent() {
  auth = await oidcSignIn({ base: BASE, subject: "backup-owner" });
  if (!auth.sessionToken) throw new Error(`backup sign-in failed: ${auth.hops?.join(" -> ")}`);
  ownerId = await withDb(dbUrlFromServer(), async (client) => {
    const result = await client.query(
      `SELECT u.id FROM users u
       JOIN accounts a ON a."userId" = u.id
       WHERE a.provider = 'stacks-test-oidc' AND a."providerAccountId" = 'backup-owner'`,
    );
    return result.rows[0].id;
  });
}

function dbUrlFromServer() {
  return process.env.STACKS_BACKUP_DB;
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
  while (Date.now() - started < 15_000) {
    try {
      await fetch(`${BASE}/api/health`, { signal: AbortSignal.timeout(400) });
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

async function startServer(databaseUrl) {
  await stopServer();
  mkdirSync(path.dirname(LOG_PATH), { recursive: true });
  serverLog = createWriteStream(LOG_PATH, { flags: "a" });
  serverLog.write(`\n--- ${new Date().toISOString()} ${databaseUrl} ---\n`);
  process.env.STACKS_BACKUP_DB = databaseUrl;
  server = spawn(NEXT_BIN, ["dev", "-H", "127.0.0.1", "-p", String(PORT)], {
    cwd: ROOT,
    env: {
      ...process.env,
      DATABASE_URL: databaseUrl,
      PGSSL: "0",
      PORT: String(PORT),
      AUTH_URL: BASE,
      AUTH_SECRET,
      STACKS_AUTH_TEST_OIDC: "1",
      STACKS_AUTH_TEST_ISSUER: fixture.issuer,
      NODE_ENV: "development",
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
    if (exitCode !== null) {
      throw new Error(`Next exited ${exitCode}. Log: ${LOG_PATH}`);
    }
    try {
      const response = await fetch(`${BASE}/api/health`);
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

async function request(pathname, options = {}) {
  const headers = new Headers(options.headers);
  if (auth.cookieHeader) headers.set("cookie", auth.cookieHeader);
  if ((options.method ?? "GET") !== "GET") headers.set("origin", BASE);
  const response = await fetch(`${BASE}${pathname}`, { ...options, headers });
  const text = await response.text();
  let data = text;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    // leave text in place
  }
  return { status: response.status, data, text };
}

async function getBackup() {
  const result = await request("/api/backup");
  assert.equal(result.status, 200, `backup download failed: ${result.text}`);
  return result.data;
}

async function restore(backup, { confirm = true, replace = false } = {}) {
  return request("/api/backup/restore", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ confirm, replace, backup }),
  });
}

async function shot(page, name) {
  mkdirSync(ARTIFACTS, { recursive: true });
  const dest = path.join(ARTIFACTS, name);
  await page.screenshot({ path: dest, fullPage: true });
  if (existsSync(CURSOR_ARTIFACTS)) {
    await copyFile(dest, path.join(CURSOR_ARTIFACTS, name));
  }
  log("screenshot", dest);
}

async function main() {
  assert.match(
    readFileSync(path.join(ROOT, "src/lib/backup.ts"), "utf8"),
    /MAX_BACKUP_BYTES = 8 \* 1024 \* 1024/,
  );

  await recreateDatabase(SRC_DB);
  await recreateDatabase(DST_DB);
  log("databases", `created ${SRC_DB} and ${DST_DB}`);
  fixture = await startOidcFixture(0);
  log("fixture", `${fixture.issuer} local OIDC, not Google`);

  await startServer(dbUrl(SRC_DB));
  log("server", `source ${BASE}`);
  const denied = await request("/api/backup");
  assert.equal(denied.status, 401);
  await signInCurrent();
  await seedShelf(SRC_DB);

  const exported = await getBackup();
  const sourceSnapshot = canonical(exported);
  assert.equal(exported.version, "1.0.0");
  assert.equal(exported.metadata.bookCount, 2);
  assert.deepEqual(exported.metadata.omittedSecretKeys, ["api_token"]);
  assert.equal(JSON.stringify(exported).includes("hunter2"), false);
  assert.equal(JSON.stringify(exported).includes("DATABASE_URL"), false);
  assert.deepEqual(sourceSnapshot.books, [BOOK_B, BOOK_A].sort((a, b) => a.id.localeCompare(b.id)));
  assert.deepEqual(sourceSnapshot.appState, {
    examples_seeded: "1",
    shelf_label: "Window seat",
  });
  log("export", "2 books, shelf_label kept, api_token omitted");

  const secretStillThere = await withDb(dbUrl(SRC_DB), (client) =>
    client.query("SELECT value FROM user_settings WHERE user_id = $1 AND key = 'api_token'", [
      ownerId,
    ]),
  );
  assert.equal(secretStillThere.rows[0]?.value, "hunter2");
  await assertLegacyRemains();

  const noConfirm = await restore(exported, { confirm: false, replace: true });
  assert.equal(noConfirm.status, 400);
  const refused = await restore(exported, { confirm: true, replace: false });
  assert.equal(refused.status, 409);
  assert.deepEqual(canonical(await getBackup()), sourceSnapshot);
  log("source-safety", "missing confirmation and non-empty restore changed nothing");

  await stopServer();
  await startServer(dbUrl(DST_DB));
  log("server", `clean destination ${BASE}`);
  await signInCurrent();
  await withDb(dbUrl(DST_DB), async (client) => {
    await client.query(
      `INSERT INTO books (id, title, author, created_at, updated_at)
       VALUES ('99999999-9999-4999-8999-999999999999', 'Legacy Unassigned', '', '2017-01-02T03:04:05.006Z', '2017-01-02T03:04:05.006Z')`,
    );
    await client.query("INSERT INTO app_state (key, value) VALUES ('legacy_label', 'leave-me')");
  });

  const emptyResult = await restore(emptyBackup(), { confirm: true, replace: false });
  assert.equal(emptyResult.status, 200, JSON.stringify(emptyResult.data));
  assert.equal(emptyResult.data.restored.books, 0);
  const emptyExported = await getBackup();
  assert.deepEqual(canonical(emptyExported), { books: [], appState: {} });
  const emptyCheck = await request("/api/backup/validate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(emptyBackup()),
  });
  assert.equal(emptyCheck.status, 200);
  assert.equal(emptyCheck.data.valid, true);
  assert.ok(emptyCheck.data.warnings.some((warning) => /zero books/i.test(warning)));
  log("empty", "empty backup restored into an empty database and warned");

  const badVersion = structuredClone(exported);
  badVersion.version = "9.9.9";
  const badVersionResult = await restore(badVersion, { confirm: true, replace: true });
  assert.equal(badVersionResult.status, 400);
  assert.match(JSON.stringify(badVersionResult.data), /Unsupported backup version/);
  assert.deepEqual(canonical(await getBackup()), { books: [], appState: {} });

  const malformed = await request("/api/backup/restore", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{",
  });
  assert.equal(malformed.status, 400);
  assert.match(malformed.data.error, /not valid JSON/);

  const restored = await restore(exported, { confirm: true, replace: false });
  assert.equal(restored.status, 200, JSON.stringify(restored.data));
  assert.equal(restored.data.restored.books, 2);
  assert.equal(restored.data.restored.appState, 2);
  const destinationSnapshot = canonical(await getBackup());
  const expectedAfterNormalize = {
    books: sourceSnapshot.books.map((book) =>
      book.id === BOOK_A.id ? { ...book, isbn: "9780451524935" } : book,
    ),
    appState: sourceSnapshot.appState,
  };
  assert.deepEqual(destinationSnapshot, expectedAfterNormalize);
  assert.equal(destinationSnapshot.books.find((book) => book.id === BOOK_B.id).isbn, "");
  await assertLegacyRemains();
  log("round-trip", "clean-database restore matched every book field and app_state key");
  log("isbn-10", "0-451-52493-4 restored as ISBN-13 9780451524935; empty ISBN stayed empty");

  const already13 = structuredClone(exported);
  already13.books.find((book) => book.id === BOOK_A.id).isbn = "9780451524935";
  const already13Result = await restore(already13, { confirm: true, replace: true });
  assert.equal(already13Result.status, 200, JSON.stringify(already13Result.data));
  assert.deepEqual(canonical(await getBackup()), destinationSnapshot);
  const hyphen13 = structuredClone(exported);
  hyphen13.books.find((book) => book.id === BOOK_A.id).isbn = "978-0-451-52493-5";
  const hyphen13Result = await restore(hyphen13, { confirm: true, replace: true });
  assert.equal(hyphen13Result.status, 200, JSON.stringify(hyphen13Result.data));
  assert.deepEqual(canonical(await getBackup()), destinationSnapshot);
  log("isbn-13", "a valid ISBN-13 and its hyphenated form stayed 9780451524935");

  const badCheck = structuredClone(exported);
  badCheck.books.find((book) => book.id === BOOK_A.id).isbn = "9780451524936";
  const badCheckPreview = await request("/api/backup/validate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(badCheck),
  });
  assert.equal(badCheckPreview.status, 200, JSON.stringify(badCheckPreview.data));
  assert.equal(badCheckPreview.data.valid, false);
  assert.match(badCheckPreview.data.errors.join("\n"), /ISBN/);
  assert.equal(badCheckPreview.data.preview, undefined);
  const badCheckRestore = await restore(badCheck, { confirm: true, replace: true });
  assert.equal(badCheckRestore.status, 400, JSON.stringify(badCheckRestore.data));
  assert.match(JSON.stringify(badCheckRestore.data.details), /ISBN/);
  assert.deepEqual(canonical(await getBackup()), destinationSnapshot);
  log("isbn-rejected", "invalid check digit failed validation and restore left the shelf unchanged");

  const cases = [
    ["unsupported version", badVersion, 400],
    [
      "duplicate id",
      {
        ...exported,
        books: [exported.books[0], { ...exported.books[0] }],
        metadata: { ...exported.metadata, bookCount: 2 },
      },
      400,
    ],
    [
      "string rating",
      {
        ...exported,
        books: exported.books.map((book, index) =>
          index === 0 ? { ...book, rating: "4" } : book,
        ),
      },
      400,
    ],
    [
      "unknown field",
      {
        ...exported,
        books: exported.books.map((book, index) =>
          index === 0 ? { ...book, shelfPosition: 3 } : book,
        ),
      },
      400,
    ],
    [
      "secret key",
      { ...exported, appState: { ...exported.appState, api_token: "hunter2" } },
      400,
    ],
  ];

  for (const [name, backup, status] of cases) {
    const result = await restore(backup, { confirm: true, replace: true });
    assert.equal(result.status, status, `${name}: ${JSON.stringify(result.data)}`);
    assert.deepEqual(canonical(await getBackup()), destinationSnapshot, name);
    log("rejected", `${name} -> ${status}, shelf unchanged`);
  }

  const blocked = await restore(exported, { confirm: true, replace: false });
  assert.equal(blocked.status, 409);
  assert.deepEqual(canonical(await getBackup()), destinationSnapshot);
  log("non-empty", "restore without replace was refused");

  const huge = JSON.stringify({ pad: "a".repeat(MAX_BACKUP_BYTES + 1) });
  const tooBig = await request("/api/backup/restore", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: huge,
  });
  assert.equal(tooBig.status, 413, JSON.stringify(tooBig.data));
  assert.deepEqual(canonical(await getBackup()), destinationSnapshot);
  log("size", "oversized file rejected");

  const [first, second] = await Promise.all([
    restore(exported, { confirm: true, replace: true }),
    restore(exported, { confirm: true, replace: true }),
  ]);
  assert.ok([200, 409].includes(first.status), JSON.stringify(first.data));
  assert.ok([200, 409].includes(second.status), JSON.stringify(second.data));
  assert.deepEqual(canonical(await getBackup()), destinationSnapshot);
  log("duplicate-submit", `parallel restores returned ${first.status} and ${second.status} without duplicating rows`);

  await withDb(dbUrl(DST_DB), async (client) => {
    await client.query(`
      CREATE OR REPLACE FUNCTION stacks_backup_fail_marker() RETURNS trigger AS $$
      BEGIN
        IF NEW.title = 'ROLLBACK-TEST' THEN
          RAISE EXCEPTION 'injected restore failure';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `);
    await client.query(`
      CREATE TRIGGER stacks_backup_fail_marker
      BEFORE INSERT ON books
      FOR EACH ROW
      EXECUTE FUNCTION stacks_backup_fail_marker()
    `);
  });

  const crashing = structuredClone(exported);
  crashing.books = [
    {
      ...BOOK_A,
      id: "33333333-3333-4333-8333-333333333333",
      title: "SHOULD-NOT-PERSIST",
    },
    {
      ...BOOK_B,
      id: "44444444-4444-4444-8444-444444444444",
      title: "ROLLBACK-TEST",
    },
  ];
  crashing.metadata = { ...crashing.metadata, bookCount: 2, omittedSecretKeys: [] };
  const crashed = await restore(crashing, { confirm: true, replace: true });
  assert.equal(crashed.status, 500, JSON.stringify(crashed.data));
  assert.match(String(crashed.data.error), /injected restore failure/);
  assert.deepEqual(canonical(await getBackup()), destinationSnapshot);
  const leaked = await withDb(dbUrl(DST_DB), (client) =>
    client.query(
      "SELECT COUNT(*)::int AS n FROM books WHERE title IN ('SHOULD-NOT-PERSIST', 'ROLLBACK-TEST')",
    ),
  );
  assert.equal(Number(leaked.rows[0].n), 0);
  log("rollback", "insert failure rolled back the delete and the partial insert");

  await withDb(dbUrl(DST_DB), async (client) => {
    await client.query("DROP TRIGGER stacks_backup_fail_marker ON books");
    await client.query("DROP FUNCTION stacks_backup_fail_marker()");
  });

  await runBrowser(exported);
  assert.deepEqual(canonical(await getBackup()), destinationSnapshot);
  log("browser", "download, invalid file, confirmation, and replace left the same shelf");

  const wiped = await restore(emptyBackup(), { confirm: true, replace: true });
  assert.equal(wiped.status, 200, JSON.stringify(wiped.data));
  assert.deepEqual(canonical(await getBackup()), { books: [], appState: {} });
  log("empty-replace", "explicit replace with an empty backup cleared the shelf");
  await assertLegacyRemains();

  mkdirSync(ARTIFACTS, { recursive: true });
  const evidencePath = path.join(ARTIFACTS, "evidence.json");
  writeFileSync(evidencePath, JSON.stringify(evidence, null, 2));
  if (existsSync(CURSOR_ARTIFACTS)) {
    writeFileSync(path.join(CURSOR_ARTIFACTS, "backup-restore-evidence.json"), JSON.stringify(evidence, null, 2));
  }
  console.log(`\nEvidence: ${evidencePath}`);
}

async function runBrowser(exported) {
  process.env.DISPLAY ||= ":1";
  const browser = await chromium.launch({
    channel: "chrome",
    headless: false,
    args: ["--no-sandbox"],
  });
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    acceptDownloads: true,
  });
  await context.addCookies([
    {
      name: auth.sessionName,
      value: auth.sessionToken,
      url: BASE,
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);
  const page = await context.newPage();
  page.setDefaultTimeout(20_000);
  const dir = await mkdtemp(path.join(tmpdir(), "stacks-backup-"));
  try {
    await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.getByTestId("book-card").filter({ hasText: "Window Seat Atlas" }).waitFor();
    await page.getByTestId("counts").filter({ hasText: "2 books" }).waitFor();
    log("browser-shelf", await page.getByTestId("counts").innerText());

    await page.getByTestId("shelf-menu").click();
    await page.getByTestId("backup-restore-menu").click();
    await page.getByTestId("backup-dialog").waitFor();

    const badJson = path.join(dir, "not-json.json");
    await writeFile(badJson, "{");
    await page.getByTestId("backup-file").setInputFiles(badJson);
    await page.getByTestId("backup-error").waitFor();
    await shot(page, "01_invalid_file.png");
    assert.equal(await page.getByTestId("backup-confirm").count(), 0);

    const badVersion = path.join(dir, "bad-version.json");
    await writeFile(badVersion, JSON.stringify({ ...exported, version: "9.9.9" }));
    await page.getByTestId("backup-file").setInputFiles(badVersion);
    await page.getByTestId("backup-invalid").waitFor();
    assert.match(await page.getByTestId("backup-invalid").innerText(), /Unsupported backup version/);
    assert.equal(await page.getByTestId("backup-confirm").count(), 0);

    const badIsbn = structuredClone(exported);
    badIsbn.books.find((book) => book.id === BOOK_A.id).isbn = "9780451524936";
    const badIsbnPath = path.join(dir, "bad-isbn.json");
    await writeFile(badIsbnPath, JSON.stringify(badIsbn));
    await page.getByTestId("backup-file").setInputFiles(badIsbnPath);
    await page.getByTestId("backup-invalid").waitFor();
    assert.match(await page.getByTestId("backup-invalid").innerText(), /ISBN/);
    assert.equal(await page.getByTestId("backup-confirm").count(), 0);

    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByTestId("backup-download").click(),
    ]);
    const downloaded = path.join(dir, "downloaded.json");
    await download.saveAs(downloaded);
    const downloadedJson = JSON.parse(readFileSync(downloaded, "utf8"));
    assert.equal(downloadedJson.books.length, 2);
    assert.equal(JSON.stringify(downloadedJson).includes("hunter2"), false);
    log("browser-download", download.suggestedFilename());

    await page.getByTestId("backup-file").setInputFiles(downloaded);
    await page.getByTestId("backup-preview").waitFor();
    await page.getByTestId("backup-replace-confirm").waitFor();
    assert.equal(await page.getByTestId("backup-confirm").isDisabled(), true);
    await shot(page, "02_confirm_required.png");
    await page.getByTestId("backup-replace-confirm").check();
    assert.equal(await page.getByTestId("backup-confirm").isEnabled(), true);
    await page.getByTestId("backup-confirm").click();
    await page.getByTestId("backup-success").waitFor();
    await shot(page, "03_restore_success.png");
    assert.match(await page.getByTestId("backup-success").innerText(), /2 books/);

    await page.getByRole("button", { name: "Close" }).click();
    await page.getByTestId("backup-dialog").waitFor({ state: "hidden" });
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.getByTestId("book-card").filter({ hasText: "Window Seat Atlas" }).waitFor();
    await page.getByTestId("book-card").filter({ hasText: "Empty Fields" }).waitFor();
    await shot(page, "04_shelf_after_reload.png");
  } finally {
    await browser.close();
    await rm(dir, { recursive: true, force: true });
  }
}

try {
  await main();
  console.log("\nPASS backup-restore");
} catch (error) {
  console.error("\nFAIL backup-restore");
  console.error(error);
  try {
    const tail = readFileSync(LOG_PATH, "utf8").split("\n").slice(-80).join("\n");
    console.error("\nServer log tail:\n", tail);
  } catch {
    // no log yet
  }
  process.exitCode = 1;
} finally {
  await stopServer();
  if (fixture) await fixture.close().catch((error) => console.error("fixture", error.message));
  await dropDatabase(SRC_DB).catch((error) => console.error("drop source", error.message));
  await dropDatabase(DST_DB).catch((error) => console.error("drop dest", error.message));
}
