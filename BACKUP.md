# Backup and restore

Stacks can download a versioned JSON copy of the shelf and put that copy back. This is a **manual, application-level** backup of the data in Postgres tables `books` and `app_state`. It is not a Postgres dump, a write-ahead log, or an automatic infrastructure backup.

Backup routes require the signed-in account. They export and replace that account's books and settings. They do not read environment variables, database URLs, or host credentials, and they do not include other accounts.

## What is in the file

Version `1.0.0` includes:

- That account's books: id, title, author, category, status, rating, notes, ISBN, year, publisher, page count, cover URL, description, example flag, created time, and updated time
- That account's settings that are not secrets (`examples_seeded`, plus any other non-secret key)
- A `metadata.bookCount` that must match the book list

ISBN text is copied as stored. Restore does not run ISBN normalization, so a value that was saved as typed stays as typed.

There are no foreign keys. A backup is one snapshot of both tables. Book ids must be unique. That is the referential check this schema has.

## What is not in the file

- Cover image bytes. `cover_url` is a link to Google Books, Open Library, or another site. The colored spines drawn in the app are computed from the title and are not stored.
- Server configuration, `DATABASE_URL`, `PGSSL`, `AUTH_SECRET`, Google client secrets, and anything else that lives only in the environment
- Accounts, sessions, OAuth tokens, and the provider subject
- Other accounts' books and settings
- Ownerless legacy books and the old shared `app_state` table. A restore does not delete them
- Setting keys whose names look like passwords, tokens, API keys, or credentials. Those keys are left on the account, omitted from the file, listed by name in `metadata.omittedSecretKeys`, and rejected if a file tries to import them
- Postgres roles, hosting configuration, and auth tables

Treat the file as private. Notes and the rest of the library are in it, in plain JSON, with no encryption.

Timestamps are stored to the millisecond. `createdAt` on the file is when that file was exported, not a column in the database.

Opening a signed-in shelf calls the example-book seed for that account only. If a restored shelf is empty and the backup did not contain `examples_seeded`, the next visit can insert the three example books for that account. A backup taken after the shelf has been opened includes that flag.

## Restore rules

Nothing is written when you choose a file. The app shows the backup version, book count, setting count, and what is already on this shelf.

- The file must be JSON, version `1.0.0`, at most 8 MB, and every field must have the type the database allows. Unknown fields are rejected so a newer file cannot be partially applied.
- A failed check or a database error leaves the shelf as it was. The replace runs in one transaction for the signed-in account: delete that account's books and settings, insert the file, then commit. A failure rolls that back. Other accounts and ownerless rows are not deleted. Secret settings already stored for the account are put back after the replace.
- An empty book list is allowed. The preview warns that restoring it leaves no books. On a shelf that already has data, that still requires the replacement confirmation below.
- If the shelf has any books or settings, restore is refused unless the request explicitly asks to replace them. The UI keeps the replace button disabled until that checkbox is checked. There is no merge and no duplicate insert.
- Confirming twice replaces the shelf with the same snapshot. It does not append a second copy.
- The live check is repeated inside the transaction after the tables are locked, so a restore that lost the race does not delete a shelf it was not allowed to replace.

## Disaster recovery

1. Keep backup files somewhere other than the machine that runs Stacks. Download one from the shelf menu after you change the library.
2. To recover, create a **new** empty Postgres database and point a Stacks process at it with `DATABASE_URL`. Do not aim a restore at a database you still need unless you mean to replace it.
3. Start the app. You can restore before browsing, or after the example books appear.
4. Open **Backup and restore** in the shelf menu.
5. Choose the file and read the counts.
6. If the shelf is empty, choose **Restore into this empty shelf**.
7. If it already has books or settings, check **Replace the current shelf with this backup**, then choose **Replace shelf with backup**.
8. Check the shelf, then download a new backup and store that too.

An invalid file, an unsupported version, or a restore without the replacement confirmation does not change the database.

## Test

`npm run test:backup` creates disposable databases, signs in through the local OIDC fixture, exports that account's shelf, restores it into a second empty database, compares every book and setting, and checks invalid files, a non-empty shelf, a mid-restore database error, and the browser confirmation flow. It does not use a production database. `npm run test:auth` checks that one account cannot read or restore over another.
