import { Pool, type QueryResult, type QueryResultRow } from "pg";

export const DEFAULT_DATABASE_URL =
  "postgres://stacks:stacks@127.0.0.1:5432/stacks";

function databaseUrl(): string {
  return process.env.DATABASE_URL?.trim() || DEFAULT_DATABASE_URL;
}

function sslOption(url: string) {
  if (process.env.PGSSL === "0") return undefined;
  if (
    process.env.PGSSL === "1" ||
    /railway|sslmode=require|amazonaws|neon\.tech|supabase/i.test(url)
  ) {
    return { rejectUnauthorized: false };
  }
  return undefined;
}

const globalForDb = globalThis as unknown as {
  stacksPool?: Pool;
  stacksReady?: Promise<void>;
};

export function getPool(): Pool {
  if (!globalForDb.stacksPool) {
    const url = databaseUrl();
    globalForDb.stacksPool = new Pool({
      connectionString: url,
      ssl: sslOption(url),
      max: 5,
    });
  }
  return globalForDb.stacksPool;
}

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT,
  email TEXT,
  "emailVerified" TIMESTAMPTZ,
  image TEXT
);

CREATE TABLE IF NOT EXISTS accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "userId" UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  provider TEXT NOT NULL,
  "providerAccountId" TEXT NOT NULL,
  refresh_token TEXT,
  access_token TEXT,
  expires_at BIGINT,
  token_type TEXT,
  scope TEXT,
  id_token TEXT,
  session_state TEXT
);

CREATE TABLE IF NOT EXISTS sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "sessionToken" TEXT NOT NULL,
  "userId" UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS verification_token (
  identifier TEXT NOT NULL,
  token TEXT NOT NULL,
  expires TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (identifier, token)
);

CREATE TABLE IF NOT EXISTS user_settings (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  PRIMARY KEY (user_id, key)
);

CREATE TABLE IF NOT EXISTS books (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  author TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'owned'
    CHECK (status IN ('owned', 'reading', 'read')),
  rating INTEGER
    CHECK (rating IS NULL OR (rating >= 1 AND rating <= 5)),
  notes TEXT NOT NULL DEFAULT '',
  isbn TEXT NOT NULL DEFAULT '',
  year INTEGER,
  publisher TEXT NOT NULL DEFAULT '',
  page_count INTEGER,
  cover_url TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  is_example BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS app_state (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

ALTER TABLE books ADD COLUMN IF NOT EXISTS owner_id UUID;
ALTER TABLE books ALTER COLUMN id SET DEFAULT gen_random_uuid();

DO $$ BEGIN
  ALTER TABLE books
    ADD CONSTRAINT books_owner_id_fkey
    FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS accounts_provider_subject_idx
  ON accounts (provider, "providerAccountId");
CREATE UNIQUE INDEX IF NOT EXISTS sessions_token_idx ON sessions ("sessionToken");
CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions ("userId");
CREATE UNIQUE INDEX IF NOT EXISTS users_email_unique_idx ON users (email) WHERE email IS NOT NULL;
CREATE INDEX IF NOT EXISTS books_owner_created_idx ON books (owner_id, created_at DESC);
CREATE INDEX IF NOT EXISTS books_unassigned_idx ON books (created_at) WHERE owner_id IS NULL;
CREATE INDEX IF NOT EXISTS books_created_at_idx ON books (created_at DESC);
`;

export async function ensureSchema(): Promise<void> {
  if (!globalForDb.stacksReady) {
    globalForDb.stacksReady = (async () => {
      await getPool().query(SCHEMA_SQL);
    })().catch((error) => {
      globalForDb.stacksReady = undefined;
      throw error;
    });
  }
  await globalForDb.stacksReady;
}

export async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params?: unknown[],
): Promise<QueryResult<T>> {
  await ensureSchema();
  return getPool().query<T>(text, params);
}
