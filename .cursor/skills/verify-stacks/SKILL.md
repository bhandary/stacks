---
name: verify-stacks
description: Verify the Stacks book shelf end to end — launch, doctor, Playwright drive at 390x844, evidence, cleanup.
---

# Verify Stacks

Use this when checking that Stacks still loads, imports ISBNs, scans a barcode, and writes through Postgres.

Default URL: `http://localhost:43177`
Default database: `postgres://stacks:stacks@127.0.0.1:5432/stacks`
Viewport: `390x844` (Playwright Chromium)

## Launch

Start Postgres if needed, then the app:

```bash
export DATABASE_URL="${DATABASE_URL:-postgres://stacks:stacks@127.0.0.1:5432/stacks}"
bash scripts/verify/launch.sh
```

`launch.sh` no-ops if `/api/health` already answers. Dev server is the default. Production mode:

```bash
STACKS_VERIFY_PROD=1 bash scripts/verify/launch.sh
```

Wait until `GET /api/health` returns `{ "ok": true, "db": true }` before driving the UI.

## Doctor

```bash
npm run verify:doctor
```

Checks node, npm, python3, ffmpeg, psql, a live Postgres that accepts `DATABASE_URL`, `npm` deps, Playwright Chromium, and generated ISBN barcode fixtures (`scripts/verify/fixtures/isbn_barcode.y4m` and `.mjpeg`). Fix whatever it prints `fail` for, then rerun. Do not skip doctor after a fresh machine or a missing camera fixture.

## Drive

```bash
npm run verify
```

`scripts/verify/drive.mjs` launches Chromium with:

- viewport `390x844`, mobile + touch
- `--use-fake-ui-for-media-stream`
- `--use-fake-device-for-media-stream`
- `--use-file-for-fake-video-capture=scripts/verify/fixtures/isbn_barcode.y4m` (ISBN `9780141439518`)

It then:

1. Loads the shelf (example books)
2. Adds a book via **manual ISBN lookup** of `9780451524935` (real Open Library / Google Books network)
3. Edits that book to **Reading** and **4 stars**
4. Searches `1984`
5. Filters status **Reading**
6. Reloads and checks the book is still there
7. Deletes it
8. Opens **Scan ISBN**, feeds the fake camera barcode, and saves the imported book

Drive uses system Chrome (`channel: "chrome"`) headed by default (`DISPLAY=:1` if unset). `HEADLESS=1` uses headless Chrome and can crash in this environment. Do not pass `--use-fake-ui-for-media-stream` together with `--auto-accept-camera-and-microphone-capture` — that pairing SIGTRAPs Chrome here. Another origin: `STACKS_URL=http://localhost:43177 npm run verify`.

The drive script deletes leftover rows with those two ISBNs first so a rerun is safe.

## Evidence

Written to `artifacts/verify/`:

| File | What it shows |
| --- | --- |
| `01_home_examples.png` | Seeded shelf |
| `02_isbn_lookup_filled.png` | Catalog fill after ISBN lookup |
| `03_after_add.png` | New card on the shelf |
| `04_after_edit.png` | Reading + stars |
| `05_search.png` | Search narrowed to 1984 |
| `06_filter.png` | Reading filter |
| `07_after_reload.png` | Same book after refresh |
| `08_after_delete.png` | 1984 gone |
| `09_scan_camera.png` | Camera overlay + fake barcode stream |
| `10_scan_imported.png` | Form filled from the scan |
| `11_after_scan_save.png` | Scanned book saved |
| `stacks_full_journey.webm` | Full Playwright recording |
| `evidence.json` | Step log |

If `/opt/cursor/artifacts` exists, the same files are copied there.

A pass means every step above ran against a live server and a real catalog lookup. A fail should leave the last screenshot and the video for debugging — fix the app or the fixture, do not hand-wave the camera step.

## Cleanup

```bash
npm run verify:cleanup
```

Stops a verify-owned Next process on `$PORT` (default 43177) and deletes generated barcode videos. It does **not** drop Postgres or `artifacts/verify/`. Rebuild fixtures with doctor before the next camera run.
