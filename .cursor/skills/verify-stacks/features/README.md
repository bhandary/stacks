# Stacks verification map

This directory is the maintained source for verifying the user-facing behavior of Stacks. Read it before driving the app, then use the matching feature file as the recipe.

## Baseline preconditions

- Launch with `bash .cursor/skills/verify-stacks/scripts/launch.sh` so the origin is `http://localhost:43177` (or the `PORT` you set) and the database name starts with `stacks_verify_`.
- `bash .cursor/skills/verify-stacks/scripts/doctor.sh` prints `Stacks verify doctor passed.`
- The login page shows **Continue with test account A**, **Continue with test account B**, and the note that this fixture is not Google.
- Google client credentials are unset on this process. **Continue with Google** is absent and `data-testid="auth-unconfigured"` is present.
- Drive only the instance whose pid and port are in the run state. Do not attach to port 43177 just because it answers.
- An empty signed-in shelf seeds Project Hail Mary, Sapiens, and The Hobbit for that account only. The launch probe signs alice in and out without calling `/api/books`, so the seed happens on the first shelf load.

## Driving conventions

- Browser harness: Playwright, system Chrome, headed, viewport `390x844`, mobile and touch, `--no-sandbox`. Leave `DISPLAY` at `:1` when it is unset.
- Prefer `data-testid` and accessible names from the feature file over coordinates.
- Sign in by clicking `continue-test-alice` or `continue-test-bob`. Use a separate browser context per account.
- Start each recipe from a fresh scratch database unless its preconditions say the shelf already has a book.
- `npm run verify` chains several features against whatever database is already in `DATABASE_URL`. It is not a pass for a single feature in this map.
- Cleanup does not delete `artifacts/verify/<run-id>/`.

## Proof and skip reporting

- Capture the click or submit and the shelf, response, or file that follows it.
- UI proof is a screenshot plus the visible email, title, or dialog text named in the feature.
- Mutation proof includes a second view: `/api/books` or `/api/auth/session` JSON, and a SQL read of `books` / `accounts` / `sessions` that does not print tokens.
- Record the feature id, entry point, URL, and git SHA in `evidence.json`.
- If a precondition is missing, stop that sub-feature and write the reason. Do not swap in a different entry point and call it verified.
- The local OIDC fixture is the accepted stand-in for Google. Do not add a second mock in front of Open Library or Google Books.

## Feature entry contract

Each feature file starts with an H1 and one paragraph, then these H2 sections in order: `Sub-features`, `How to get to it (user POV)`, `Driving it with Playwright`, `Gotchas`.

## Features

- [Sign in and per-user shelves](./sign-in.md) covers fixture sign-in, a private book, account B's separate shelf, and sign-out.
- [Add and edit a book](./add-edit-book.md) covers manual save, ISBN lookup, status and rating, reload, delete, and storing a valid ISBN as ISBN-13.
- [Catalog lookup and shelf search](./catalog-search.md) covers merged catalog fields plus search (title, author, ISBN, and category), status, category, and sort.
- [Backup export and restore](./backup-restore.md) covers download, preview, confirmed replace, ISBN-13 normalization on restore, and the other account staying put.
- [Scan an ISBN](./scan-isbn.md) covers the camera barcode and the typed ISBN on the scan screen.
