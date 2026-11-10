/**
 * Browser proof for features/sign-in.md.
 * Signs in as test account A, adds a private book, signs in as test account B
 * in a second context, then signs A out. Reads /api/books and the scratch database.
 */
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const repoRoot = path.resolve(new URL(".", import.meta.url).pathname, "../../../..");
const statePath =
  process.env.STACKS_VERIFY_STATE || path.join(repoRoot, "artifacts/verify/current-run.env");

function readState(file) {
  const state = {};
  for (const line of readFileSync(file, "utf8").split("\n")) {
    if (!line || !line.includes("=")) continue;
    const index = line.indexOf("=");
    state[line.slice(0, index)] = line.slice(index + 1);
  }
  return state;
}

if (!existsSync(statePath)) {
  console.error(`fail  no run state at ${statePath}`);
  process.exit(1);
}

const state = readState(statePath);
const base = state.AUTH_URL;
const evidenceDir = path.join(state.EVIDENCE_DIR, "sign-in");
mkdirSync(evidenceDir, { recursive: true });

const evidence = {
  feature: "sign-in",
  base,
  sha: state.SHA,
  database: state.DB_NAME,
  provider: "stacks-test-oidc",
  google: false,
  steps: [],
  artifacts: [],
};

function log(name, detail) {
  evidence.steps.push({ name, detail, at: new Date().toISOString() });
  console.log(`• ${name}: ${detail}`);
}

function publish(file) {
  evidence.artifacts.push(file);
  const mirror = "/opt/cursor/artifacts";
  if (existsSync(mirror)) {
    const destDir = path.join(mirror, "verify-stacks", state.RUN_ID, "sign-in");
    mkdirSync(destDir, { recursive: true });
    copyFileSync(file, path.join(destDir, path.basename(file)));
  }
}

function writeJson(name, value) {
  const file = path.join(evidenceDir, name);
  writeFileSync(file, JSON.stringify(value, null, 2));
  publish(file);
  return file;
}

async function shot(page, name) {
  const file = path.join(evidenceDir, name);
  await page.screenshot({ path: file, fullPage: true });
  publish(file);
  log("screenshot", file);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function query(sql) {
  return execFileSync(
    "psql",
    [state.DATABASE_URL, "-v", "ON_ERROR_STOP=1", "-At", "-F", "\t", "-c", sql],
    { encoding: "utf8" },
  ).trim();
}

async function booksFrom(page) {
  return page.evaluate(async () => {
    const response = await fetch("/api/books");
    const body = await response.json().catch(() => null);
    return { status: response.status, body };
  });
}

async function sessionFrom(page) {
  return page.evaluate(async () => {
    const response = await fetch("/api/auth/session");
    const body = await response.json().catch(() => null);
    return {
      status: response.status,
      email: body?.user?.email ?? null,
      name: body?.user?.name ?? null,
    };
  });
}

process.env.DISPLAY ||= ":1";
const browser = await chromium.launch({
  channel: "chrome",
  headless: false,
  args: ["--no-sandbox"],
});

try {
  const aliceContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  });
  const alice = await aliceContext.newPage();
  alice.setDefaultTimeout(60_000);
  await alice.goto(`${base}/login?error=AccessDenied`, { waitUntil: "domcontentloaded" });
  await alice.getByTestId("login-error").waitFor();
  const loginError = await alice.getByTestId("login-error").innerText();
  assert(
    loginError.includes("Sign-in did not finish. No shelf was opened."),
    `login-error was ${loginError}`,
  );
  assert((await alice.getByTestId("continue-test-alice").count()) === 1, "test account missing beside login error");
  assert((await alice.getByTestId("auth-unconfigured").count()) === 1, "auth-unconfigured missing beside login error");
  await shot(alice, "00_login_error.png");
  log("login-error", loginError.trim());

  await alice.goto(base, { waitUntil: "domcontentloaded" });
  assert((await alice.getByTestId("login-error").count()) === 0, "login-error rendered without an error query");
  await alice.getByTestId("test-oidc-note").waitFor();
  await alice.getByTestId("continue-test-alice").waitFor();
  await alice.getByTestId("auth-unconfigured").waitFor();
  assert((await alice.getByTestId("continue-google").count()) === 0, "Google button was rendered");
  await shot(alice, "01_login.png");
  log("login", "Test account A is offered and Google credentials are not configured");

  await alice.getByTestId("continue-test-alice").click();
  await alice.getByTestId("signed-in-as").waitFor();
  const aliceWho = await alice.getByTestId("signed-in-as").innerText();
  assert(aliceWho.includes("alice@example.test"), `signed-in-as was ${aliceWho}`);
  await alice.getByRole("heading", { name: "Project Hail Mary" }).waitFor();
  await alice.getByRole("heading", { name: "Sapiens" }).waitFor();
  await alice.getByRole("heading", { name: "The Hobbit" }).waitFor();
  const aliceSession = await sessionFrom(alice);
  const aliceBooks = await booksFrom(alice);
  writeJson("alice-session.json", aliceSession);
  writeJson("alice-books.json", aliceBooks);
  assert(aliceSession.email === "alice@example.test", "alice session email mismatch");
  assert(aliceBooks.status === 200, `alice /api/books status ${aliceBooks.status}`);
  const seeded = (aliceBooks.body?.books ?? []).map((book) => book.title).sort();
  assert(
    seeded.join("|") === ["Project Hail Mary", "Sapiens", "The Hobbit"].sort().join("|"),
    `alice seed titles ${seeded.join(", ")}`,
  );
  await shot(alice, "02_alice_shelf.png");
  log("alice-shelf", aliceWho);

  await alice.getByTestId("add-book").click();
  await alice.getByRole("dialog", { name: "Add a book" }).waitFor();
  await alice.getByTestId("title-input").fill("Lantern Notes");
  await alice.getByTestId("author-input").fill("Ada Verify");
  await alice.getByTestId("notes-input").fill("Only on Alice's shelf");
  await shot(alice, "03_alice_form.png");
  await alice.getByTestId("save-book").click();
  await alice.getByRole("dialog").waitFor({ state: "hidden" });
  await alice.getByRole("heading", { name: "Lantern Notes" }).waitFor();
  const aliceAfter = await booksFrom(alice);
  writeJson("alice-books-after.json", aliceAfter);
  const aliceTitles = (aliceAfter.body?.books ?? []).map((book) => book.title);
  assert(aliceTitles.includes("Lantern Notes"), "Lantern Notes missing from alice /api/books");
  await shot(alice, "04_alice_private.png");
  log("alice-private", "Saved Lantern Notes on account A");

  const bobContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  });
  const bob = await bobContext.newPage();
  bob.setDefaultTimeout(60_000);
  await bob.goto(`${base}/login`, { waitUntil: "domcontentloaded" });
  await bob.getByTestId("continue-test-bob").click();
  await bob.getByTestId("signed-in-as").waitFor();
  const bobWho = await bob.getByTestId("signed-in-as").innerText();
  assert(bobWho.includes("bob@example.test"), `bob signed-in-as was ${bobWho}`);
  await bob.getByRole("heading", { name: "The Hobbit" }).waitFor();
  assert((await bob.getByRole("heading", { name: "Lantern Notes" }).count()) === 0, "Bob sees Alice's book");
  const bobSession = await sessionFrom(bob);
  const bobBooks = await booksFrom(bob);
  writeJson("bob-session.json", bobSession);
  writeJson("bob-books.json", bobBooks);
  const bobTitles = (bobBooks.body?.books ?? []).map((book) => book.title);
  assert(bobSession.email === "bob@example.test", "bob session email mismatch");
  assert(!bobTitles.includes("Lantern Notes"), `bob /api/books included Lantern Notes: ${bobTitles.join(", ")}`);
  assert(bobTitles.includes("Sapiens"), "bob shelf did not seed examples");
  await shot(bob, "05_bob_shelf.png");
  log("bob-shelf", `${bobWho}; titles ${bobTitles.join(", ")}`);

  await alice.getByTestId("shelf-menu").click();
  await alice.getByTestId("sign-out").click();
  await alice.getByTestId("continue-test-alice").waitFor();
  await shot(alice, "06_alice_signed_out.png");
  log("sign-out", "Account A returned to the login page");

  const unsigned = await fetch(`${base}/api/books`, { redirect: "manual" });
  const unsignedBody = await unsigned.text();
  const unsignedFile = path.join(evidenceDir, "books-unsigned.json");
  writeFileSync(unsignedFile, JSON.stringify({ status: unsigned.status, body: unsignedBody }, null, 2));
  publish(unsignedFile);
  assert(unsigned.status === 401, `unsigned /api/books status ${unsigned.status}`);
  assert(unsignedBody.includes("Sign in required"), `unsigned body ${unsignedBody}`);

  const rows = query(`
    SELECT u.email, a.provider, a."providerAccountId",
           (a.access_token IS NULL) AS access_token_cleared,
           (a.id_token IS NULL) AS id_token_cleared,
           COALESCE(b.title, ''), COALESCE(b.notes, ''), COALESCE(b.is_example::text, '')
    FROM users u
    JOIN accounts a ON a."userId" = u.id
    LEFT JOIN books b ON b.owner_id = u.id
    ORDER BY 1, 6
  `);
  const sessions = query(`
    SELECT u.email, count(s.id)::text
    FROM users u
    LEFT JOIN sessions s ON s."userId" = u.id
    GROUP BY u.email
    ORDER BY 1
  `);
  const shelfFile = path.join(evidenceDir, "shelf-rows.tsv");
  writeFileSync(shelfFile, `${rows}\n\n${sessions}\n`);
  publish(shelfFile);
  assert(rows.includes("alice@example.test\tstacks-test-oidc\talice\tt\tt\tLantern Notes\tOnly on Alice's shelf\tfalse"), "alice private row missing or token was stored");
  assert(!rows.includes("bob@example.test\tstacks-test-oidc\tbob\tt\tt\tLantern Notes"), "bob owns Lantern Notes");
  assert(sessions.includes("alice@example.test\t0"), `alice sessions were not cleared:\n${sessions}`);
  assert(sessions.includes("bob@example.test\t1"), `bob session missing:\n${sessions}`);
  log("database", "Lantern Notes belongs to alice; bob has a separate shelf; alice's session is gone");

  evidence.passed = true;
  const evidenceFile = writeJson("evidence.json", evidence);
  log("done", evidenceFile);
} catch (error) {
  evidence.passed = false;
  evidence.error = error instanceof Error ? error.message : String(error);
  try {
    const pages = browser.contexts().flatMap((context) => context.pages());
    if (pages[0]) await shot(pages[0], "failure.png");
  } catch {
    // The failure screenshot is best-effort.
  }
  writeJson("evidence.json", evidence);
  console.error(error);
  process.exitCode = 1;
} finally {
  await browser.close();
}
