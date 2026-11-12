# Backup export and restore

Backup downloads the signed-in account's books and non-secret settings as one JSON file. Restore replaces that account's shelf only after the file is previewed and, when the shelf is not empty, after the replacement checkbox is checked. A non-empty ISBN in the file must be a valid ISBN-10 or ISBN-13 and is stored as ISBN-13. An invalid ISBN fails the preview and writes nothing.

## Sub-features

- `backup-download` saves a version `1.0.0` file whose `metadata.bookCount` matches the shelf.
- `backup-preview` checks a chosen file and writes nothing until confirm.
- `backup-replace` puts the downloaded shelf back after a book was removed.
- `backup-other-account` leaves account B's books in place through A's restore.
- `backup-invalid-isbn` rejects a copy of that download whose ISBN check digit is wrong, and writes nothing.
- `backup-isbn13` stores an ISBN-10 from a copy of that download as ISBN-13.

## How to get to it (user POV)

- Sign in, open **Shelf menu** (`data-testid="shelf-menu"`), and choose **Backup & Restore** (`data-testid="backup-restore-menu"`).
- The dialog is named `Backup and restore` (`data-testid="backup-dialog"`).
- **Download backup** is `data-testid="backup-download"`.
- The file input is `data-testid="backup-file"`.
- The replacement checkbox is `data-testid="backup-replace-confirm"`.
- Confirm is `data-testid="backup-confirm"`. Its name is `Replace shelf with backup` when the shelf already has books or settings, and `Restore into this empty shelf` when it does not.

## Driving it with Playwright

Preconditions:

- Doctor passed.
- Account A is signed in and the three example books are on the shelf. If they are not, stop and report the missing seed. Do not hand-write a backup file to skip the download.
- Account B has signed in once in another browser context and still has a book that A does not, such as a manual title `Bob Marker`. Create that marker through B's **Add book** form before A's restore.

- **Download.** On A's page, click `shelf-menu`, then `backup-restore-menu`. Wait for `backup-dialog`. Click `backup-download` and save the Playwright download. The file is JSON, `version` is `1.0.0`, and `metadata.bookCount` equals the number of `book-card` elements (3 before any extra add). The file contains `Project Hail Mary` and does not contain `Bob Marker`. SQL row counts for A are unchanged by the download.
- **Preview.** Remove nothing yet. Set `backup-file` to that download. Wait for `data-testid="backup-preview"`. The preview text includes `Version 1.0.0` and the book count. `backup-confirm` is disabled until `backup-replace-confirm` is checked, because the shelf has books and `examples_seeded`. SQL book ids for A are unchanged while the preview is open.
- **Replace.** Delete nothing from the file. On the shelf, open The Hobbit and click `delete-book`. The Hobbit card is gone and `/api/books` no longer lists it. Open **Backup & Restore** again, choose the same file, check `backup-replace-confirm`, and click `backup-confirm`. Wait for `data-testid="backup-success"`. The Hobbit heading is back. `/api/books` lists the same three titles as the file. SQL shows those titles on A's `owner_id`.
- **Other account.** In B's context, reload the shelf. The heading `Bob Marker` is still visible, and The Hobbit's presence on B is only B's own example, not a copy of A's restored row. SQL shows `Bob Marker` still on B's `owner_id` and not on A's.
- **Invalid ISBN.** Copy the downloaded file and set one book's `isbn` to `9780000000000`. Leave `metadata.bookCount` alone. Choose that copy on A's dialog. `data-testid="backup-invalid"` includes `ISBN must be empty or a valid ISBN-10 or ISBN-13.` No `backup-confirm` button is shown. The SQL count of A's books is unchanged. Close the dialog.
- **ISBN-13.** Copy the downloaded file again and set the Project Hail Mary `isbn` to `0593135202`. Choose that copy, check `backup-replace-confirm`, and click `backup-confirm`. Wait for `backup-success`. `SELECT isbn FROM books` for that title on A's `owner_id` returns `9780593135204`. This replace puts the file's books back, so run it after the happy-path assertions.
- **Proof.** Keep the downloaded JSON, the invalid copy, screenshots of the preview, the invalid preview, the success line, A's restored shelf, and B's marker, plus the SQL owner listing and the restored ISBN. Directory: `artifacts/verify/<run-id>/backup-restore/`.

## Gotchas

- Choosing a file does not write. A preview screenshot without the success line is not a restore.
- Removing the example books does not make the shelf empty for restore. `examples_seeded` remains in `user_settings`, so the checkbox is still required. The confirm button stays disabled until it is checked.
- The download is per account. A's file must not be judged by the whole `books` table, which also holds B and any ownerless legacy rows.
- Restore uses the same ISBN rule as save. An empty ISBN stays empty. A valid ISBN-10 or ISBN-13 is stored as digits-only ISBN-13, so an ISBN-10 in the file does not come back as typed. Any other non-empty ISBN fails validation, the preview lists the error, and the shelf is not changed. A file downloaded from this shelf already holds ISBN-13s, so the happy-path restore brings those same ISBN strings back.
- Cover bytes are not in the file. A restored card can show a generated spine when the cover URL fails to load. Assert the title.
- `npm run test:backup` covers malformed files and a mid-restore database error. This journey covers a bad ISBN check digit and the happy path. Do not mark the database-error case passed because those worked.
