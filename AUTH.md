# Sign-in

Stacks uses [Auth.js](https://authjs.dev) (`next-auth` 5) with the Google provider. Auth.js speaks OpenID Connect through `oauth4webapi`: discovery, PKCE, `state`, `nonce`, and ID-token checks for issuer, audience, and expiry. That library's current release leaves the signature as a separate call, and Auth.js does not make it, so Stacks verifies the ID token signature, issuer, audience, and expiry with `jose` against the provider's published keys before the token is accepted. A failed check does not create a user or a session.

A shelf belongs to the signed-in account. The account key is the provider id plus the OIDC `sub` (`accounts.provider` + `accounts.providerAccountId`). Email is display text and a collision backstop. It is not the owner key.

The first successful sign-in creates the local user. The same provider and subject signs in again to that same user. A second subject is a different shelf, even when the email matches. Unverified `email_verified` claims are refused. Google access tokens, refresh tokens, and ID tokens are not stored. The session cookie is HttpOnly and `SameSite=Lax`; it is `Secure` when `AUTH_URL` is `https`. The database stores only a SHA-256 hash of the session token. Sessions last 14 days. Sign-out deletes the row. An expired row is rejected and deleted.

Scopes are `openid`, `email`, and `profile`. The authorization request uses `access_type=online` and does not ask for a refresh token. Stacks does not request Gmail or any other Google API.

If `AUTH_URL`, `AUTH_SECRET`, or the Google client is missing, Google sign-in is not registered. The login page says so, and book, lookup, and backup routes stay closed. There is no production bypass.

## Google Cloud

Create an OAuth client in [Google Cloud Console](https://console.cloud.google.com/apis/credentials). This is a prerequisite for a real Gmail sign-in. The repo does not contain a client id or secret, and this change does not put them in Railway.

1. Create or choose a project.
2. Configure the OAuth consent screen.
   - User type: External, unless this is a private Workspace app.
   - App name: Stacks.
   - Scopes: `openid`, `.../auth/userinfo.email`, and `.../auth/userinfo.profile` only. Do not add Gmail.
   - While the app is in Testing, add each Gmail address under Test users. Those users can sign in before the app is published.
   - Publishing the consent screen for any Google user requires a domain you control. `stacks-production-8e25.up.railway.app` sits on `railway.app`, which you cannot verify. Leave the app in Testing, or add a custom domain you own, before expecting Google to accept a public consent screen.
3. Create an OAuth client ID of type **Web application**.
4. Authorized JavaScript origins:
   - `http://localhost:43177`
   - `https://stacks-production-8e25.up.railway.app`
5. Authorized redirect URIs, exactly:
   - `http://localhost:43177/api/auth/callback/google`
   - `https://stacks-production-8e25.up.railway.app/api/auth/callback/google`

`AUTH_URL` must be the origin people type in the browser. Next.js rewrites a loopback host to `localhost` before Auth.js builds the callback, so local `AUTH_URL` is `http://localhost:43177`, not `http://127.0.0.1:43177`. A localhost callback does not match `127.0.0.1`, and the reverse is also true.

## Environment

Placeholders live in `.env.example`. Do not commit real values.

| Variable | Local | Railway |
| --- | --- | --- |
| `AUTH_URL` | `http://localhost:43177` | `https://stacks-production-8e25.up.railway.app` |
| `AUTH_SECRET` | `openssl rand -base64 32` | a different value from the same command |
| `AUTH_GOOGLE_ID` | the web client id | the same client id |
| `AUTH_GOOGLE_SECRET` | the web client secret | the same client secret |
| `DATABASE_URL` | local Postgres | injected by the Postgres plugin |

`AUTH_SECRET` must be at least 32 characters. Set the four Auth variables in the Railway service. Do not set `AUTH_TRUST_HOST` or `AUTH_REDIRECT_PROXY_URL`. Do not set `STACKS_AUTH_TEST_OIDC` on Railway. The app deletes a stray redirect-proxy variable at startup and ignores the test provider when `NODE_ENV` is `production` or any Railway variable is present.

Cookies on the production URL are `Secure` because `AUTH_URL` is `https`. Railway terminates TLS.

## Legacy shelves

Books and `app_state` rows from before accounts have no owner. The migration adds `books.owner_id` as nullable and does not fill it. New accounts do not see those rows, and a restore does not delete them. Nothing is assigned to the first person who signs in.

To attach that shelf to one verified Google account, restore a copy of the database on localhost and run the dry-run:

```bash
DATABASE_URL=postgres://stacks:stacks@127.0.0.1:5432/stacks_copy \
STACKS_LEGACY_OWNER_PROVIDER=google \
STACKS_LEGACY_OWNER_SUBJECT='the Google sub claim' \
node --experimental-strip-types scripts/legacy/assign-owner.mts
```

The person must already have signed in once, so the `sub` has a row in `accounts`. Optional `STACKS_LEGACY_OWNER_EMAIL` is only a cross-check against that row. The script refuses when `NODE_ENV` is `production`, when Railway variables are set, or when the database host is not `localhost` or `127.0.0.1`. It prints the ownerless book ids and does not write.

Writing requires both flags, still only against a local database:

```bash
STACKS_LEGACY_ASSIGN_APPLY=yes \
node --experimental-strip-types scripts/legacy/assign-owner.mts --apply
```

That sets `owner_id` on rows where it is null and copies non-secret `app_state` keys into that account's settings. It does not delete `app_state`, books, sessions, or any row that already has an owner. Run it against a copy. Do not point it at production.

## Local test identity

`npm run test:auth` and the backup test start an OIDC server on `127.0.0.1`. Auth.js performs discovery, PKCE, state, and nonce against that server. `jose` rejects a bad signature, the wrong issuer, the wrong audience, and an expired token. The provider id is `stacks-test-oidc`. The login page says this fixture is not Google. The provider is registered only when all of these are true: `STACKS_AUTH_TEST_OIDC=1`, `NODE_ENV` is not `production`, the issuer is `http://127.0.0.1` or `http://localhost`, `AUTH_URL` is local, and no Railway or Vercel variable is set.

`scripts/verify/launch.sh` starts that fixture when Google credentials are absent, so the shelf journey can sign in on this machine. Production `next start` does not.
