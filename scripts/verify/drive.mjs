#!/usr/bin/env node
import { spawn } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const PORT = process.env.PORT || "43177";
const BASE = process.env.STACKS_URL || `http://localhost:${PORT}`;
const ARTIFACTS = path.join(ROOT, "artifacts/verify");
const CURSOR_ARTIFACTS = "/opt/cursor/artifacts";
const FIXTURES = path.join(ROOT, "scripts/verify/fixtures");
const MANUAL_ISBN = "9780451524935";
const SCAN_ISBN = "9780141439518";

const evidence = {
  base: BASE,
  viewport: { width: 390, height: 844 },
  steps: [],
  artifacts: [],
};

function log(name, detail) {
  evidence.steps.push({ name, detail, at: new Date().toISOString() });
  console.log(`• ${name}: ${detail}`);
}

async function waitForHealth(timeoutMs = 90_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const response = await fetch(`${BASE}/api/health`);
      if (response.ok) return;
    } catch {
      // Server still booting.
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Stacks did not become healthy at ${BASE}/api/health`);
}

async function api(pathname, init) {
  const response = await fetch(`${BASE}${pathname}`, init);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`${init?.method || "GET"} ${pathname} failed: ${payload.error || response.status}`);
  }
  return payload;
}

async function resetTestBooks() {
  const { books } = await api("/api/books");
  for (const book of books) {
    if (book.isbn === MANUAL_ISBN || book.isbn === SCAN_ISBN) {
      await api(`/api/books/${book.id}`, { method: "DELETE" });
    }
  }
}

function ensureFixtures() {
  const y4m = path.join(FIXTURES, "isbn_barcode.y4m");
  if (existsSync(y4m)) return y4m;
  const result = spawn("python3", [path.join(ROOT, "scripts/verify/generate_barcode_video.py")], {
    cwd: ROOT,
    stdio: "inherit",
  });
  return new Promise((resolve, reject) => {
    result.on("exit", (code) => {
      if (code === 0 && existsSync(y4m)) resolve(y4m);
      else reject(new Error("Failed to generate ISBN barcode video"));
    });
  });
}

function publish(src, name) {
  mkdirSync(ARTIFACTS, { recursive: true });
  const dest = path.join(ARTIFACTS, name);
  if (src !== dest) copyFileSync(src, dest);
  evidence.artifacts.push(dest);
  if (existsSync(CURSOR_ARTIFACTS)) {
    copyFileSync(src, path.join(CURSOR_ARTIFACTS, name));
  }
  return dest;
}

async function shot(page, name) {
  mkdirSync(ARTIFACTS, { recursive: true });
  const dest = path.join(ARTIFACTS, name);
  await page.screenshot({ path: dest, fullPage: true });
  publish(dest, name);
  log("screenshot", dest);
}

async function main() {
  mkdirSync(ARTIFACTS, { recursive: true });
  const cameraFile = await ensureFixtures();
  await waitForHealth();
  await resetTestBooks();
  log("ready", `${BASE} healthy, fixtures at ${cameraFile}`);

  process.env.DISPLAY ||= ":1";
  // fake-ui + auto-accept together SIGTRAPs Chrome in this environment.
  const chromeArgs = [
    "--no-sandbox",
    "--use-fake-ui-for-media-stream",
    "--use-fake-device-for-media-stream",
    `--use-file-for-fake-video-capture=${cameraFile}`,
  ];
  const headed = process.env.HEADLESS !== "1";
  const browser = await chromium.launch({
    channel: "chrome",
    headless: headed ? false : true,
    args: chromeArgs,
  });

  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    permissions: ["camera"],
    recordVideo: {
      dir: path.join(ARTIFACTS, "video-raw"),
      size: { width: 390, height: 844 },
    },
  });

  const page = await context.newPage();
  page.setDefaultTimeout(20_000);

  try {
    await page.goto(BASE, { waitUntil: "networkidle" });
    await page.getByTestId("book-card").first().waitFor();
    await shot(page, "01_home_examples.png");
    log("home", await page.getByTestId("counts").innerText());

    await page.getByTestId("add-book").click();
    await page.getByTestId("isbn-input").fill(MANUAL_ISBN);
    await page.getByTestId("lookup-isbn").click();
    await page.getByTestId("title-input").waitFor();
    await page.waitForFunction(() => {
      const input = document.querySelector('[data-testid="title-input"]');
      return Boolean(input && input.value && /1984|nineteen/i.test(input.value));
    }, null, { timeout: 25_000 });
    const importedTitle = await page.getByTestId("title-input").inputValue();
    log("isbn-lookup", `Imported "${importedTitle}" for ${MANUAL_ISBN}`);
    await shot(page, "02_isbn_lookup_filled.png");

    await page.getByTestId("save-book").click();
    await page.getByRole("dialog").waitFor({ state: "hidden" });
    await page.getByTestId("book-card").filter({ hasText: importedTitle }).waitFor();
    await shot(page, "03_after_add.png");

    await page.getByTestId("book-card").filter({ hasText: importedTitle }).click();
    await page.getByTestId("status-select").selectOption("reading");
    await page.getByTestId("rating-star-4").click();
    await page.getByTestId("save-book").click();
    await page.getByRole("dialog").waitFor({ state: "hidden" });
    const edited = page.getByTestId("book-card").filter({ hasText: importedTitle });
    await edited.getByTestId("status-badge").filter({ hasText: "Reading" }).waitFor();
    await edited.getByTestId("rating-stars").waitFor();
    log("edit", "Set status to Reading and rating to 4 stars");
    await shot(page, "04_after_edit.png");

    await page.getByTestId("search").fill("1984");
    await page.getByTestId("book-card").filter({ hasText: importedTitle }).waitFor();
    const searchCount = await page.getByTestId("book-card").count();
    if (searchCount !== 1) throw new Error(`Search should show 1 book, showed ${searchCount}`);
    log("search", "Search for 1984 hid the other books");
    await shot(page, "05_search.png");

    await page.getByTestId("search").fill("");
    await page.getByTestId("filter-status").selectOption("reading");
    await page.getByTestId("book-card").filter({ hasText: importedTitle }).waitFor();
    const titles = await page.getByTestId("book-card").evaluateAll((nodes) =>
      nodes.map((node) => node.getAttribute("data-title")),
    );
    if (!titles.every((title) => title === importedTitle || title === "Sapiens")) {
      throw new Error(`Unexpected reading filter titles: ${titles.join(", ")}`);
    }
    log("filter", `Reading filter showed: ${titles.join(", ")}`);
    await shot(page, "06_filter.png");

    await page.getByTestId("filter-status").selectOption("all");
    await page.reload({ waitUntil: "networkidle" });
    await page.getByTestId("book-card").filter({ hasText: importedTitle }).waitFor();
    const persisted = page.getByTestId("book-card").filter({ hasText: importedTitle });
    await persisted.getByTestId("status-badge").filter({ hasText: "Reading" }).waitFor();
    log("persist", "1984 still present with Reading after reload");
    await shot(page, "07_after_reload.png");

    await persisted.click();
    await page.getByTestId("delete-book").scrollIntoViewIfNeeded();
    await page.getByTestId("delete-book").click();
    await page.getByTestId("book-card").filter({ hasText: importedTitle }).waitFor({
      state: "detached",
      timeout: 15_000,
    });
    log("delete", "1984 removed from the shelf");
    await shot(page, "08_after_delete.png");

    await page.getByTestId("scan-isbn").click();
    await page.getByTestId("scan-overlay").waitFor();
    await page.getByTestId("scan-video").waitFor();
    await page.getByTestId("scan-status").filter({ hasText: /Found 9780141439518/ }).waitFor({
      timeout: 35_000,
    });
    await shot(page, "09_scan_camera.png");

    await page.getByTestId("title-input").waitFor({ timeout: 35_000 });
    await page.waitForFunction(() => {
      const input = document.querySelector('[data-testid="title-input"]');
      return Boolean(input && input.value && /pride|austen|prejudice/i.test(input.value));
    }, null, { timeout: 35_000 });
    const scannedTitle = await page.getByTestId("title-input").inputValue();
    const scannedIsbn = await page.getByTestId("isbn-input").inputValue();
    if (!scannedIsbn.includes("9780141439518")) {
      throw new Error(`Scan imported unexpected ISBN ${scannedIsbn}`);
    }
    log("scan", `Camera decoded ${scannedIsbn} and imported "${scannedTitle}"`);
    await shot(page, "10_scan_imported.png");

    await page.getByTestId("save-book").click();
    await page.getByRole("dialog").waitFor({ state: "hidden" });
    await page.getByTestId("book-card").filter({ hasText: scannedTitle }).waitFor();
    await shot(page, "11_after_scan_save.png");
    log("done", "Full journey passed");
  } catch (error) {
    await shot(page, "failure.png").catch(() => undefined);
    throw error;
  } finally {
    const video = page.video();
    await page.close();
    if (video) {
      const raw = await video.path();
      const named = path.join(ARTIFACTS, "stacks_full_journey.webm");
      copyFileSync(raw, named);
      publish(named, "stacks_full_journey.webm");
      log("video", named);
    }
    await context.close();
    await browser.close();
    writeFileSync(path.join(ARTIFACTS, "evidence.json"), JSON.stringify(evidence, null, 2));
    if (existsSync(CURSOR_ARTIFACTS)) {
      copyFileSync(
        path.join(ARTIFACTS, "evidence.json"),
        path.join(CURSOR_ARTIFACTS, "evidence.json"),
      );
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
