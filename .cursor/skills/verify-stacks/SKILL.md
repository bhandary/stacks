---
name: verify-stacks
description: Verify the Stacks book shelf — the Next.js UI on http://localhost:43177 and the /login, /api/books, /api/lookup, /api/backup, and /api/auth routes — by launching an isolated local Postgres database, signing in through the stacks-test-oidc fixture, and driving Playwright at 390x844. Use after shelf, ISBN, backup, or sign-in changes.
---

# Verify Stacks

Stacks is a Next.js 16 shelf. A person signs in, then searches, adds, edits, scans, and backs up books in Postgres. Book, lookup, and backup routes stay closed until that sign-in. This skill launches a disposable copy, checks it, and drives it the way that person would.

Do not point it at Railway, Neon, Supabase, or any other hosted database. Do not set `STACKS_AUTH_TEST_OIDC` on a production build. The Google client id and secret are not required here and must not be printed.

The local identity provider is `stacks-test-oidc` (`scripts/test/oidc-fixture.mjs`). It stands in for Google at the OIDC boundary Auth.js already has. It is not Google. `next start` and `NODE_ENV=production` do not register it.

Default origin: `http://localhost:43177`. Another port needs `PORT` and `STACKS_OIDC_FIXTURE_PORT` together. Viewport for UI proof: `390x844`.

## Launch

From the repo root:

```bash
bash .cursor/skills/verify-stacks/scripts/launch.sh
```

What that does:

1. Refuses the port (`43177` unless `PORT` is set) or the fixture port (`43179` unless `STACKS_OIDC_FIXTURE_PORT` is set) when something is already listening. It will not attach to a shelf it did not start.
2. Ignores an ambient `DATABASE_URL`. It creates `stacks_verify_<run-id>` on local Postgres (`127.0.0.1:5432`, role `stacks` / password `stacks`, the same local role as the README). Hosted URLs are rejected before that.
3. Starts the Postgres 16 cluster with `pg_ctlcluster` when `pg_isready` fails. `apt-get install postgresql` on this image can leave the cluster stopped because `policy-rc.d` blocks the package start.
4. Generates a one-run `AUTH_SECRET` (mode `600`, under `/tmp/stacks-verify-<run-id>/secret`). It does not print the secret.
5. Starts `scripts/test/oidc-fixture.mjs` on the fixture port, then the repo dev command: `node_modules/.bin/next dev -H 0.0.0.0 -p $PORT`. The child environment sets `STACKS_AUTH_TEST_OIDC=1`, `STACKS_AUTH_TEST_ISSUER=http://127.0.0.1:<fixture-port>`, `AUTH_URL=http://localhost:<port>`, and `PGSSL=0`. It unsets `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET`, `AUTH_REDIRECT_PROXY_URL`, `NODE_ENV`, and Railway/Vercel variables so the fixture is allowed and this run does not call Google.
6. Waits until the app is usable, not merely bound:
   - `GET /api/health` returns `{"ok":true,"db":true}` (`ensureSchema` has created `users`, `accounts`, `sessions`, `books`, and `user_settings`)
   - discovery answers at `$STACKS_AUTH_TEST_ISSUER/.well-known/openid-configuration`
   - a fixture sign-in as subject `alice` returns a session whose `/api/auth/session` email is `alice@example.test`, then that probe signs out

Ready prints `Stacks verify launch ready` plus the URL, database name, issuer, git SHA, state file, and evidence directory. The process keeps running after the script exits. State lives in `/tmp/stacks-verify-<run-id>/run.env`. A symlink `artifacts/verify/current-run.env` points at the latest run.

`npm ci` runs only when `node_modules/.bin/next` is missing. Postgres packages are not installed automatically. If `psql` or `pg_isready` is missing, install them and rerun:

```bash
sudo apt-get install -y postgresql postgresql-client
```

Teardown is `cleanup.sh` in the Cleanup section. Do not use `scripts/verify/launch.sh` for this skill: if `/api/health` already answers it exits 0 and leaves you on someone else's process, and it does not create a scratch database.

One `next dev` per checkout. Next.js 16 exits a second dev server in this directory with `Another next dev server is already running`, even when `PORT` differs. Stop the recorded server with `cleanup.sh` before launching again. Launch prints a state path. Pass that path as `STACKS_VERIFY_STATE` to doctor, drive, and cleanup when `artifacts/verify/current-run.env` points at a different attempt. If launch fails after it has started the fixture or the dev server, it stops that attempt and drops that scratch database.

## Doctor

```bash
bash .cursor/skills/verify-stacks/scripts/doctor.sh
```

Read-only. It does not start Postgres, install packages, write rows, or generate fixtures. It reads `STACKS_VERIFY_STATE` or `artifacts/verify/current-run.env` and checks:

- the recorded app pid is alive
- the process listening on the recorded port is that pid or a descendant in its process group
- `git rev-parse HEAD` matches the SHA recorded at launch, and the server cwd is this repo
- `GET /api/health` is still `{"ok":true,"db":true}`
- `psql` can `SELECT 1` on the scratch database, and the five tables above exist
- the fixture discovery document's `issuer` is the recorded issuer
- `GET /api/auth/providers` includes `stacks-test-oidc`
- `GET /login` contains `data-testid="continue-test-alice"` and `data-testid="test-oidc-note"`

A passing run prints `Stacks verify doctor passed.` Fix a `fail` line before driving. Doctor does not mean the browser journey passed.

## Drive

Harness: Playwright against system Chrome (`channel: "chrome"`), headed, viewport `390x844`, `isMobile` and `hasTouch`, `--no-sandbox`. `DISPLAY` defaults to `:1` when unset. Do not add `--use-fake-ui-for-media-stream` except in the scan feature, and never combine it with `--auto-accept-camera-and-microphone-capture` (that pairing SIGTRAPs Chrome here).

Sign in only through the login page. There is no test-only setter that opens a shelf.

| Control | Handle |
| --- | --- |
| Test account A | `data-testid="continue-test-alice"` (subject `alice`, email `alice@example.test`, name `Test alice`) |
| Test account B | `data-testid="continue-test-bob"` (subject `bob`, email `bob@example.test`, name `Test bob`) |
| Fixture disclosure | `data-testid="test-oidc-note"` |
| Google missing | `data-testid="auth-unconfigured"` (expected on this launch, because Google credentials are unset) |
| Who is signed in | `data-testid="signed-in-as"` |
| Shelf menu | `aria-label="Shelf menu"` and `data-testid="shelf-menu"` |
| Sign out | `data-testid="sign-out"` |

Open `AUTH_URL` from the run file (it is `http://localhost:<port>`, never `http://127.0.0.1`). Click **Continue with test account A** or **B**. Wait until `signed-in-as` shows that account's `@example.test` email. Use a second browser context for the other account so the cookies do not mix. The session cookie is HttpOnly; do not read it from `document.cookie`.

The sign-in and isolation journey is:

```bash
node .cursor/skills/verify-stacks/scripts/drive-sign-in.mjs
```

The typed scan path, including a bad check digit, is:

```bash
node .cursor/skills/verify-stacks/scripts/drive-scan-isbn.mjs
```

Other features use the same browser settings and the same sign-in. Their steps are in `features/`. `npm run verify` (`scripts/verify/drive.mjs`) is a separate full-shelf script: it signs in only as account A, looks up a live ISBN, edits, searches, deletes, and scans. It does not create a scratch database, does not prove account B, and deletes rows for `9780451524935` and `9780141439518`. Do not treat it as a substitute for one feature file.

`npm run test:auth` and `npm run test:backup` are HTTP and browser checks against their own disposable databases. They are not this UI map. `npm run formal:isbn` checks ISBN check digits. `npm run check:lookup` stubs `fetch` and does not prove a live catalog merge.

## Evidence

Write proof under `artifacts/verify/<run-id>/` (gitignored). Cleanup must leave that directory in place. When `/opt/cursor/artifacts` exists, copy the same files to `/opt/cursor/artifacts/verify-stacks/<run-id>/`.

A passing drive records the action and the state after it:

- screenshots of the login click, the shelf that resulted, the other account's shelf, and sign-out
- response bodies: `/api/auth/session`, `/api/books` for each account, and an unauthenticated `GET /api/books`
- a SQL listing of email, provider, `providerAccountId`, title, notes, and `is_example` (no session token, access token, or id token values)
- `evidence.json` with the feature id, URL, and SHA

The OIDC fixture is the only stand-in. It replaces Google at the existing Auth.js provider boundary. Catalog calls in the add-book and scan features are real Open Library and Google Books HTTP requests, not a stub. `npm run check:lookup` is a stubbed dry-run: it never opens those hosts, which you can see because the harness replaces `globalThis.fetch` and asserts the URL shape locally.

Screenshots and JSON from a failed drive stay on disk. Do not delete them to make a rerun look clean.

## Cleanup

```bash
bash .cursor/skills/verify-stacks/scripts/cleanup.sh
```

Kills the recorded app and fixture process groups (`SIGTERM`, then `SIGKILL` if the port is still open). It does not use `pkill` or kill by process name. It drops only a database whose name matches `stacks_verify_[a-z0-9_]+` from the state file. It deletes `/tmp/stacks-verify-<run-id>/` (including the generated secret) and the `current-run.env` symlink when that symlink points at this run.

It does not delete `artifacts/verify/<run-id>/` or `/opt/cursor/artifacts/verify-stacks/`.

Do not run `npm run verify:cleanup`. That script `pkill`s `next dev` by command line and can stop a server this skill does not own.

Run cleanup after a failed launch or drive before the next attempt, so ports and scratch databases do not linger.

## Helpers

| Script | Invocation |
| --- | --- |
| `scripts/launch.sh` | `bash .cursor/skills/verify-stacks/scripts/launch.sh` |
| `scripts/doctor.sh` | `bash .cursor/skills/verify-stacks/scripts/doctor.sh` |
| `scripts/cleanup.sh` | `bash .cursor/skills/verify-stacks/scripts/cleanup.sh` |
| `scripts/ready-sign-in.mjs` | Called by `launch.sh`. Runs the alice probe and sign-out. `AUTH_URL` must already be the launched origin. |
| `scripts/drive-sign-in.mjs` | `node .cursor/skills/verify-stacks/scripts/drive-sign-in.mjs` |
| `scripts/drive-scan-isbn.mjs` | `node .cursor/skills/verify-stacks/scripts/drive-scan-isbn.mjs` |

All three shell scripts are executable. `STACKS_VERIFY_STATE` overrides the current-run symlink for doctor, cleanup, drive, and the ready probe's sibling scripts.
