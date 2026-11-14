/**
 * Browser proof for the typed ISBN path in features/scan-isbn.md.
 * Leaves the camera unavailable so a stale getUserMedia error is visible,
 * then checks a bad check digit, a short value, and two valid ISBNs.
 * Does not decode a barcode or save a book.
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
const evidenceDir = path.join(state.EVIDENCE_DIR, "scan-isbn");
mkdirSync(evidenceDir, { recursive: true });

const VALID_MESSAGE = "Enter a valid ISBN-10 or ISBN-13.";
const evidence = {
  feature: "scan-isbn",
  base,
  sha: state.SHA,
  database: state.DB_NAME,
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
    const destDir = path.join(mirror, "verify-stacks", state.RUN_ID, "scan-isbn");
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
    [state.DATABASE_URL, "-v", "ON_ERROR_STOP=1", "-At", "-c", sql],
    { encoding: "utf8" },
  ).trim();
}

function shelfIsbns() {
  return query(`SELECT coalesce(isbn, '') || '|' || title FROM books ORDER BY title`);
}

process.env.DISPLAY ||= ":1";
const browser = await chromium.launch({
  channel: "chrome",
  headless: false,
  args: ["--no-sandbox"],
});

try {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();
  page.setDefaultTimeout(30_000);

  await page.goto(base, { waitUntil: "domcontentloaded" });
  await page.getByTestId("continue-test-alice").click();
  await page.getByTestId("signed-in-as").waitFor();
  const who = await page.getByTestId("signed-in-as").innerText();
  assert(who.includes("alice@example.test"), `signed-in-as was ${who}`);
  await page.getByRole("heading", { name: "Project Hail Mary" }).waitFor();
  const before = shelfIsbns();
  writeJson("books-before.json", { rows: before });
  log("signed-in", who);

  await page.getByTestId("scan-isbn").click();
  await page.getByTestId("scan-overlay").waitFor();
  await page.getByTestId("scan-error").waitFor();
  const cameraError = (await page.getByTestId("scan-error").innerText()).trim();
  const cameraStatus = (await page.getByTestId("scan-status").innerText()).trim();
  log("camera", `status=${cameraStatus} error=${cameraError}`);
  assert(cameraError === "Requested device not found", `expected stale camera error, got ${cameraError}`);
  assert(cameraStatus.includes("Camera unavailable"), `status was ${cameraStatus}`);
  assert((await page.getByRole("heading", { name: "Add a book" }).count()) === 0, "form opened before Use");
  await shot(page, "01_camera_unavailable.png");

  async function submitManual(value) {
    await page.getByTestId("manual-isbn").fill(value);
    await page.getByTestId("manual-isbn-submit").click();
  }

  async function expectRejected(label) {
    await page.getByTestId("scan-overlay").waitFor();
    const message = (await page.getByTestId("scan-error").innerText()).trim();
    assert(message === VALID_MESSAGE, `${label} error was ${message}`);
    assert(
      (await page.getByRole("heading", { name: "Add a book" }).count()) === 0,
      `${label} opened the add form`,
    );
    const after = shelfIsbns();
    assert(after === before, `${label} changed SQL\nbefore ${before}\nafter ${after}`);
    log(label, message);
  }

  await submitManual("9780451524934");
  await expectRejected("bad-isbn-13");
  await shot(page, "02_bad_check_digit.png");

  await submitManual("123");
  await expectRejected("short-isbn");
  await shot(page, "03_short_isbn.png");

  await submitManual("0451524935");
  await expectRejected("bad-isbn-10");
  await shot(page, "04_bad_isbn10.png");

  async function expectAccepted(typed, canonical, shotName) {
    await submitManual(typed);
    await page.getByRole("heading", { name: "Add a book" }).waitFor();
    assert((await page.getByTestId("scan-overlay").count()) === 0, `${typed} left the overlay up`);
    await page.waitForFunction(
      (expected) => {
        const input = document.querySelector('[data-testid="isbn-input"]');
        return Boolean(input && input.value === expected);
      },
      canonical,
      { timeout: 25_000 },
    );
    await page.waitForFunction(
      () => {
        const input = document.querySelector('[data-testid="title-input"]');
        return Boolean(input && /1984|nineteen/i.test(input.value));
      },
      null,
      { timeout: 25_000 },
    );
    const isbn = await page.getByTestId("isbn-input").inputValue();
    const title = await page.getByTestId("title-input").inputValue();
    assert(isbn === canonical, `${typed} stored ${isbn}`);
    log(typed, `form isbn=${isbn} title=${title}`);
    await shot(page, shotName);
    const during = shelfIsbns();
    assert(during === before, `${typed} wrote a row before save`);
    await page.getByRole("dialog").getByRole("button", { name: "Close" }).click();
    await page.getByRole("heading", { name: "Add a book" }).waitFor({ state: "hidden" });
  }

  await expectAccepted("9780451524935", "9780451524935", "05_valid_isbn13.png");

  await page.getByTestId("scan-isbn").click();
  await page.getByTestId("scan-overlay").waitFor();
  await page.getByTestId("scan-error").waitFor();
  const cameraAgain = (await page.getByTestId("scan-error").innerText()).trim();
  assert(cameraAgain === "Requested device not found", `second open error was ${cameraAgain}`);
  await expectAccepted("0451524934", "9780451524935", "06_valid_isbn10.png");

  const after = shelfIsbns();
  assert(after === before, `shelf changed\n${after}`);
  writeJson("books-after.json", { rows: after });
  log("done", "bad check digits show the ISBN error; valid 13 and 10 open the form");
} finally {
  writeJson("evidence.json", evidence);
  await browser.close();
}
