# Stacks

A mobile-friendly shelf for a personal book collection. Add books by hand, look up an ISBN, or scan a barcode with the phone camera. Catalog details come from Open Library and Google Books. The shelf lives in Postgres, so it survives a refresh and a deploy.

## Run locally

Postgres on `127.0.0.1:5432` with this default (override with `DATABASE_URL`):

```
postgres://stacks:stacks@127.0.0.1:5432/stacks
```

```bash
# Debian/Ubuntu
sudo apt-get install -y postgresql
sudo pg_ctlcluster 16 main start
sudo -u postgres psql -c "CREATE USER stacks WITH PASSWORD 'stacks';"
sudo -u postgres psql -c "CREATE DATABASE stacks OWNER stacks;"

cp .env.example .env.local
npm install
npm run dev
```

The app listens on `http://localhost:43177`. Open that on a phone or a narrow desktop window. First visit seeds three example books; **Remove examples** deletes only those.

`npm start` after `npm run build` binds `0.0.0.0` and honors `PORT` (Railway sets this).

## What you can do

- Search title, author, or ISBN
- Filter by category or status, and sort the list
- Add, edit, or delete a book (title, author, category, status, rating, notes, ISBN)
- Look up an ISBN and import title, authors, category, year, publisher, page count, cover, and description
- Scan an ISBN with the camera (`BarcodeDetector`, with a ZXing fallback) or type it if the camera is unavailable
- Persist everything in Postgres

## Deploy on Railway

Do not need a second service for the app. Add a Postgres plugin and one web service.

1. Create a Railway project and empty service from this repo.
2. Add **Postgres**. Railway injects `DATABASE_URL`.
3. The web service should use `npm run build` then `npm run start`. `railway.json` sets the start command and a `/api/health` check. A `Dockerfile` is here if you prefer image builds.
4. Set `PORT` only if you are not using Railway’s default. Next.js already reads `PORT`.
5. Deploy. The schema is created on first request; example books seed only when the table is empty.

Hosted Postgres that requires TLS is detected from the URL (Railway, Neon, Supabase, `sslmode=require`). Force it with `PGSSL=1` if needed.

## Verify

A project skill at `.cursor/skills/verify-stacks/` documents launch, doctor, drive, evidence, and cleanup.

```bash
npm run verify:doctor
bash scripts/verify/launch.sh &
npm run verify
```

Playwright drives Chromium at **390×844**, looks up a real ISBN, edits status and rating, searches, filters, deletes, reloads, then feeds a fake camera stream of an ISBN barcode. Screenshots and a journey video land in `artifacts/verify/`.
