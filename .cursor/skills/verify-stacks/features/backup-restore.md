# Backup export and restore

Backup downloads the signed-in account's books and non-secret settings as one JSON file. Restore replaces that account's shelf only after the file is previewed and, when the shelf is not empty, after the replacement checkbox is checked.

## Sub-features

- `backup-download` saves a version `1.0.0` file whose `metadata.bookCount` matches the shelf.
- `backup-preview` checks a chosen file and writes nothing until confirm.
- `backup-replace` puts the downloaded shelf back after a book was removed.
- `backup-other-account` leaves account B's books in place through A's restore.
- `backup-isbn10` stores a valid ISBN-10 from the file as ISBN-13.
- `backup-invalid-isbn` shows the preview error for a bad check digit and writes nothing.

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
- **Replace.** Delete nothing from the file. On the shelf, open The Hobbit and click `delete-book`. The Hobbit card is gone and `/api/books` no longer lists it. Open **Backup & Restore** again, choose the same file, check `backup-replace-confirm`, and click `backup-confirm`. Wait for `data-testid="backup-success"`. The dialog stays open over the shelf, and the book headings are not an accessible target while it is open. Close it with Escape or the Close button. The Hobbit heading is then visible. `/api/books` lists the same three titles as the file. SQL shows those titles on A's `owner_id`.
- **Other account.** In B's context, reload the shelf. The heading `Bob Marker` is still visible, and The Hobbit's presence on B is only B's own example, not a copy of A's restored row. SQL shows `Bob Marker` still on B's `owner_id` and not on A's.
- **ISBN-10.** Copy the downloaded file and set The Hobbit's `isbn` to `054792822X`. Leave every other field. Open **Backup & Restore**, choose that copy, check `backup-replace-confirm`, and click `backup-confirm`. Wait for `backup-success`, then close the dialog. SQL for The Hobbit on A is `9780547928227`.
- **Invalid ISBN.** Copy the downloaded file and set one book's `isbn` to `9780547928228`. Choose that copy. `data-testid="backup-invalid"` includes `ISBN must be empty or a valid ISBN-10 or ISBN-13.` `backup-confirm` is absent. SQL book ids and ISBNs for A are unchanged from before this file was chosen.
- **Proof.** Keep the downloaded JSON, screenshots of the preview, the success line, A's restored shelf, the invalid ISBN preview, and B's marker, plus the SQL owner listing. Directory: `artifacts/verify/<run-id>/backup-restore/`.

## Gotchas

- Choosing a file does not write. A preview screenshot without the success line is not a restore.
- Removing the example books does not make the shelf empty for restore. `examples_seeded` remains in `user_settings`, so the checkbox is still required. The confirm button stays disabled until it is checked.
- The download is per account. A's file must not be judged by the whole `books` table, which also holds B and any ownerless legacy rows.
- Restore uses the same ISBN rule as saving a book. An empty ISBN stays empty. A valid ISBN-10 or ISBN-13 is stored as the normalized ISBN-13, so an ISBN-10 in the file is rewritten. An invalid ISBN fails the preview and writes nothing. A file whose ISBNs are already ISBN-13 round-trips those strings.
- Cover bytes are not in the file. A restored card can show a generated spine when the cover URL fails to load. Assert the title.
- `npm run test:backup` covers other invalid files and a mid-restore database error. This journey covers a bad ISBN check digit. Do not mark the database-error case passed because this path worked.
