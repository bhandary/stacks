# Scan an ISBN

Scan opens the camera, reads an ISBN barcode, and drops the catalog result into the add-book form. The same screen can take a typed ISBN. The typed path is its own sub-feature, not a substitute when the camera does not decode.

## Sub-features

- `scan-camera` decodes the fixture barcode `9780141439518` from the fake camera and opens a filled add form.
- `scan-save` saves that imported book on the signed-in shelf.
- `scan-manual` types a second ISBN into `manual-isbn` and reaches a filled form from **Use**.
- `scan-manual-invalid` shows an error for a number that is not an ISBN, including a 10- or 13-digit value with a bad check digit, and does not open the form.

## How to get to it (user POV)

- Sign in and choose **Scan ISBN** (`data-testid="scan-isbn"`).
- The overlay is `data-testid="scan-overlay"`. The video is `data-testid="scan-video"`. Status text is `data-testid="scan-status"`.
- The typed field is `data-testid="manual-isbn"` and the button is `data-testid="manual-isbn-submit"` (accessible name `Use`).
- **Close** leaves the overlay without saving.

## Driving it with Playwright

Typed check digits, with the camera left unavailable:

```bash
node .cursor/skills/verify-stacks/scripts/drive-scan-isbn.mjs
```

That script covers `123`, `9780451524934`, `0451524935`, `9780451524935`, and `0451524934`. It does not run `scan-camera` or `scan-save`.

Preconditions:

- Doctor passed and account A is signed in.
- `scripts/verify/fixtures/isbn_barcode.y4m` exists and is the barcode for `9780141439518`. It is gitignored. Generate it with `python3 scripts/verify/generate_barcode_video.py` before this journey. If the file is missing, stop `scan-camera`. Do not type the ISBN and call the camera sub-feature passed.
- Launch Chrome with `--use-fake-ui-for-media-stream`, `--use-fake-device-for-media-stream`, and `--use-file-for-fake-video-capture=<repo>/scripts/verify/fixtures/isbn_barcode.y4m`. Do not also pass `--auto-accept-camera-and-microphone-capture`.
- The camera sub-feature and the manual sub-feature need a live catalog lookup after the ISBN is accepted.

- **Camera.** Click `scan-isbn`. Wait for `scan-overlay` and `scan-video`. Wait until `scan-status` contains `Found 9780141439518` (the overlay then closes on its own). The dialog `Add a book` shows `isbn-input` containing `9780141439518` and `title-input` matching `/pride|prejudice|austen/i`. Screenshot the overlay when the status says Found, and screenshot the filled form. This is `scan-camera`. If the status stays on `Camera unavailable` or never reports that ISBN, `scan-camera` fails even if `manual-isbn` could have been used.
- **Save.** Click `save-book`. The card for that title is visible, and `/api/books` plus SQL show ISBN `9780141439518` on A's `owner_id`. Screenshot the shelf.
- **Manual.** Delete that card so the next save is obvious. Click `scan-isbn` again. Fill `manual-isbn` with `9780451524935` and click `manual-isbn-submit`. The add dialog's title matches `/1984|nineteen/i` and the ISBN field contains `9780451524935`. Close the dialog without saving so the shelf does not have to keep both imports. Screenshot the filled form. ISBN-10 `0451524934` uses the same **Use** path and fills `9780451524935`.
- **Invalid.** Open scan again. With the camera unavailable, `data-testid="scan-error"` first reads `Requested device not found`. Fill `manual-isbn` with `9780451524934` and click `manual-isbn-submit`. `scan-error` then reads `Enter a valid ISBN-10 or ISBN-13.` The overlay stays up and the add dialog stays closed. SQL gains no row. `123` and a 10-digit bad check digit such as `0451524935` show that same error and also leave the form closed.
- **Proof.** Screenshots of the found barcode, the imported form, the saved card, the manual form, and the invalid error, plus `/api/books` after save and the SQL ISBN row. Directory: `artifacts/verify/<run-id>/scan-isbn/`.

## Gotchas

- `Found <isbn>` is painted for about 800ms and then the overlay closes and lookup starts. Wait for the status or the title field. Do not require the overlay to still be up when the form is filled.
- Headless Chrome plus the fake video flags has crashed in this environment. Use headed Chrome (`DISPLAY=:1`, `channel: "chrome"`).
- `npm run verify` runs this camera path and then saves the book. It also deletes a pre-existing `9780141439518` row first. A scratch database from this skill will not have that row until this journey saves it.
- Lookup can 429 on Google Books. `scan-camera` still needs a title in the form. If the form opens with an empty title and the ISBN filled, lookup failed. That is a failure of the import, not a camera pass.
- `BarcodeDetector` is tried before ZXing. The status `Point the camera at an ISBN barcode` means the detector is running and has not read the fixture yet.
