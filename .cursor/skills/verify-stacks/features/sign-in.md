# Sign in and per-user shelves

Sign-in lets a person open only their shelf. Test account A and test account B are different shelves, even though both see the same three example titles after their first visit.

## Sub-features

- `sign-in-unconfigured-google` shows that this launch has the fixture and does not have Google credentials.
- `sign-in-error` shows the failed sign-in banner when `/login` is opened with an error query while signed out.
- `sign-in-alice` opens account A's shelf from **Continue with test account A**.
- `sign-in-private-book` saves a book that exists only on that shelf.
- `sign-in-bob` opens account B in a second browser context and does not show A's private book.
- `sign-in-sign-out` returns A to the login page and removes A's session row.
- `sign-in-unsigned` keeps `GET /api/books` closed with no cookie.

## How to get to it (user POV)

- Open the site origin. An unsigned visit lands on `/login`.
- A failed return lands on `/login?error=AccessDenied` and shows the banner **Sign-in did not finish. No shelf was opened.**
- Choose **Continue with test account A** or **Continue with test account B**.
- After the shelf loads, open **Shelf menu** and choose **Sign out**.

## Driving it with Playwright

Preconditions:

- `doctor.sh` passed for this run.
- `AUTH_URL` is the `http://localhost:<port>` value in the run state.
- No Google button is expected. The fixture note is expected.

```bash
node .cursor/skills/verify-stacks/scripts/drive-sign-in.mjs
```

The script does the following and fails if any observable result is missing:

- **Failed sign-in.** While signed out, open `${AUTH_URL}/login?error=AccessDenied`. `data-testid="login-error"` reads `Sign-in did not finish. No shelf was opened.` The test-account buttons and `auth-unconfigured` are still present. Screenshot `00_login_error.png`. Then open `AUTH_URL` with no error query. `login-error` has count 0.
- **Open login.** `page.goto(AUTH_URL)` and wait for `data-testid="continue-test-alice"`, `data-testid="test-oidc-note"`, and `data-testid="auth-unconfigured"`. `continue-google` has count 0. Screenshot `01_login.png`.
- **Sign in as A.** Click `continue-test-alice`. Wait until `data-testid="signed-in-as"` contains `alice@example.test` and the headings `Project Hail Mary`, `Sapiens`, and `The Hobbit` are visible. `fetch("/api/auth/session")` returns that email. `fetch("/api/books")` returns HTTP 200 and those three titles. Screenshot `02_alice_shelf.png`.
- **Add a private book.** Click `data-testid="add-book"`. In the dialog named `Add a book`, fill `title-input` with `Lantern Notes`, `author-input` with `Ada Verify`, and `notes-input` with `Only on Alice's shelf`. Screenshot `03_alice_form.png`. Click `save-book`. The dialog closes and the heading `Lantern Notes` is visible. `/api/books` includes that title. Screenshot `04_alice_private.png`.
- **Sign in as B.** A new browser context opens `${AUTH_URL}/login` and clicks `continue-test-bob`. `signed-in-as` contains `bob@example.test`. The heading `Lantern Notes` has count 0. `/api/books` does not include it and does include `Sapiens`. Screenshot `05_bob_shelf.png`.
- **Sign out A.** On A's page, click `shelf-menu`, then `sign-out`. `continue-test-alice` is visible again. Screenshot `06_alice_signed_out.png`.
- **Closed shelf.** `GET /api/books` with no cookie returns HTTP 401 and `Sign in required`.
- **Database.** `accounts.provider` is `stacks-test-oidc`. Subjects are `alice` and `bob`. `access_token` and `id_token` are null. `Lantern Notes` / `Only on Alice's shelf` is on alice with `is_example` false. Bob has no such title. Alice has 0 session rows. Bob has 1.

Proof files land in `artifacts/verify/<run-id>/sign-in/`: the screenshots above, `alice-session.json`, `alice-books.json`, `alice-books-after.json`, `bob-session.json`, `bob-books.json`, `books-unsigned.json`, `shelf-rows.tsv`, and `evidence.json`.

## Gotchas

- `AUTH_URL` must be `http://localhost:<port>`. A `127.0.0.1` origin does not match the callback Next.js builds for localhost.
- Both accounts receive example books titled Project Hail Mary, Sapiens, and The Hobbit. Matching titles are not isolation. The private title is the proof.
- The launch probe signs alice in through HTTP and then signs out. It does not seed books. The browser shelf load does.
- A's cookie stays in the first context. Signing B in on the same page replaces A's session in that browser. Use a second context.
- The session cookie is HttpOnly. A script that only sets `document.cookie` is not this sign-in.
- `next start` does not render the test buttons. Do not prove this feature against `STACKS_VERIFY_PROD=1`.
- `npm run test:auth` injects a fake Google client so **Continue with Google** renders. This launch does not. Do not fail the doctor because that button is missing, and do not click it.
- Any non-empty `error` query shows the same banner. A signed-in visit to `/login` redirects home and does not show it. Open the error URL before clicking a test account.
