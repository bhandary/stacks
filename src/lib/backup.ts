import { canonicalIsbn } from "./books";
import { getPool, query } from "./db";
import { isSecretAppStateKey } from "./secret-key";
import type { Book, BookStatus } from "./types";

/** Backup format. Reject anything else so a newer or older file cannot be applied by guessing. */
export const BACKUP_VERSION = "1.0.0";

export const MAX_BACKUP_BYTES = 8 * 1024 * 1024;
export const MAX_BOOKS = 20_000;
export const MAX_APP_STATE_KEYS = 200;

const BOOK_FIELDS = [
  "id",
  "title",
  "author",
  "category",
  "status",
  "rating",
  "notes",
  "isbn",
  "year",
  "publisher",
  "pageCount",
  "coverUrl",
  "description",
  "isExample",
  "createdAt",
  "updatedAt",
] as const;

const TOP_LEVEL_FIELDS = ["version", "createdAt", "books", "appState", "metadata"] as const;
const METADATA_FIELDS = ["bookCount", "note", "omittedSecretKeys"] as const;

const TEXT_LIMITS: Record<string, number> = {
  title: 4_000,
  author: 4_000,
  category: 4_000,
  notes: 100_000,
  isbn: 4_000,
  publisher: 4_000,
  coverUrl: 4_000,
  description: 100_000,
};

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const INT4_MIN = -2147483648;
const INT4_MAX = 2147483647;
const MAX_ERRORS = 50;

const BACKUP_NOTE =
  "Portable backup of one Stacks account. It includes that account's books and settings only. Accounts, sessions, tokens, other people's shelves, and ownerless legacy rows are not included. Cover images are external URLs; image bytes and server secrets are not included.";

export type BackupData = {
  version: string;
  createdAt: string;
  books: Book[];
  appState: Record<string, string>;
  metadata: {
    bookCount: number;
    note: string;
    omittedSecretKeys: string[];
  };
};

export type DestinationCounts = {
  bookCount: number;
  appStateCount: number;
};

export type BackupPreview = {
  version: string;
  createdAt: string;
  bookCount: number;
  appStateCount: number;
  exampleBookCount: number;
};

export type ValidationResult = {
  valid: boolean;
  errors: string[];
  warnings: string[];
  backup?: BackupData;
  preview?: BackupPreview;
};

export class BackupRejected extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "BackupRejected";
    this.status = status;
  }
}

export class BackupInvalidError extends Error {
  readonly errors: string[];
  constructor(errors: string[]) {
    super("Backup validation failed");
    this.name = "BackupInvalidError";
    this.errors = errors;
  }
}

export class RestoreRefusedError extends Error {
  readonly bookCount: number;
  readonly appStateCount: number;
  constructor(bookCount: number, appStateCount: number) {
    super(
      `This shelf already has ${bookCount} books and ${appStateCount} settings. Restore was refused so nothing was overwritten. Confirm replacement to put the backup in place of the current shelf.`,
    );
    this.name = "RestoreRefusedError";
    this.bookCount = bookCount;
    this.appStateCount = appStateCount;
  }
}

type BookRow = {
  id: string;
  title: string;
  author: string;
  category: string;
  status: BookStatus;
  rating: number | null;
  notes: string;
  isbn: string;
  year: number | null;
  publisher: string;
  page_count: number | null;
  cover_url: string;
  description: string;
  is_example: boolean;
  created_at: Date;
  updated_at: Date;
};

function mapBook(row: BookRow): Book {
  return {
    id: row.id.toLowerCase(),
    title: row.title,
    author: row.author,
    category: row.category,
    status: row.status,
    rating: row.rating,
    notes: row.notes,
    isbn: row.isbn,
    year: row.year,
    publisher: row.publisher,
    pageCount: row.page_count,
    coverUrl: row.cover_url,
    description: row.description,
    isExample: row.is_example,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function pushError(errors: string[], message: string) {
  if (errors.length < MAX_ERRORS) errors.push(message);
  else if (errors.length === MAX_ERRORS) {
    errors.push("Too many errors; fix the first ones and validate again.");
  }
}

function isCanonicalTimestamp(value: unknown): value is string {
  if (typeof value !== "string" || !ISO_RE.test(value)) return false;
  const parsed = new Date(value);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString() === value;
}

function isInt4(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= INT4_MIN &&
    value <= INT4_MAX
  );
}

export { isSecretAppStateKey } from "./secret-key";

export async function createBackup(ownerId: string): Promise<BackupData> {
  const booksResult = await query<BookRow>(
    `SELECT id, title, author, category, status, rating, notes, isbn, year,
            publisher, page_count, cover_url, description, is_example, created_at, updated_at
     FROM books
     WHERE owner_id = $1
     ORDER BY created_at ASC, id ASC`,
    [ownerId],
  );
  const stateResult = await query<{ key: string; value: string }>(
    "SELECT key, value FROM user_settings WHERE user_id = $1 ORDER BY key ASC",
    [ownerId],
  );

  const appState: Record<string, string> = {};
  const omittedSecretKeys: string[] = [];
  for (const row of stateResult.rows) {
    if (isSecretAppStateKey(row.key)) {
      omittedSecretKeys.push(row.key);
      continue;
    }
    appState[row.key] = row.value;
  }
  omittedSecretKeys.sort();

  const books = booksResult.rows.map(mapBook);
  return {
    version: BACKUP_VERSION,
    createdAt: new Date().toISOString(),
    books,
    appState,
    metadata: {
      bookCount: books.length,
      note: BACKUP_NOTE,
      omittedSecretKeys,
    },
  };
}

export function validateBackupData(data: unknown): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!isPlainObject(data)) {
    return { valid: false, errors: ["Backup must be a JSON object."], warnings };
  }

  for (const key of Object.keys(data)) {
    if (!TOP_LEVEL_FIELDS.includes(key as (typeof TOP_LEVEL_FIELDS)[number])) {
      pushError(errors, `Unsupported backup field "${key}".`);
    }
  }

  if (data.version !== BACKUP_VERSION) {
    pushError(
      errors,
      `Unsupported backup version: ${JSON.stringify(data.version)} (expected ${BACKUP_VERSION}).`,
    );
  }

  if (!isCanonicalTimestamp(data.createdAt)) {
    pushError(
      errors,
      "createdAt must be a UTC timestamp with milliseconds, such as 2020-01-02T03:04:05.006Z.",
    );
  }

  const books: Book[] = [];
  const seenIds = new Set<string>();
  if (!Array.isArray(data.books)) {
    pushError(errors, "books must be an array.");
  } else if (data.books.length > MAX_BOOKS) {
    pushError(errors, `Backup has ${data.books.length} books, above the limit of ${MAX_BOOKS}.`);
  } else {
    data.books.forEach((entry, index) => {
      const label = `Book ${index + 1}`;
      if (!isPlainObject(entry)) {
        pushError(errors, `${label} must be an object.`);
        return;
      }
      for (const key of Object.keys(entry)) {
        if (!BOOK_FIELDS.includes(key as (typeof BOOK_FIELDS)[number])) {
          pushError(errors, `${label} has unsupported field "${key}".`);
        }
      }

      let id = "";
      if (typeof entry.id !== "string" || !UUID_RE.test(entry.id)) {
        pushError(errors, `${label} must have a UUID id.`);
      } else {
        id = entry.id.toLowerCase();
        if (seenIds.has(id)) pushError(errors, `${label} repeats id ${id}.`);
        seenIds.add(id);
      }

      const text: Record<string, string> = {};
      for (const field of Object.keys(TEXT_LIMITS)) {
        const value = entry[field];
        const limit = TEXT_LIMITS[field];
        if (typeof value !== "string") {
          pushError(errors, `${label} field ${field} must be a string.`);
          text[field] = "";
        } else if (value.length > limit) {
          pushError(errors, `${label} field ${field} exceeds ${limit} characters.`);
          text[field] = value;
        } else {
          text[field] = value;
        }
      }

      let status: BookStatus = "owned";
      if (entry.status !== "owned" && entry.status !== "reading" && entry.status !== "read") {
        pushError(errors, `${label} status must be owned, reading, or read.`);
      } else {
        status = entry.status;
      }

      if (entry.rating !== null && !isInt4(entry.rating)) {
        pushError(errors, `${label} rating must be null or an integer from 1 to 5.`);
      } else if (typeof entry.rating === "number" && (entry.rating < 1 || entry.rating > 5)) {
        pushError(errors, `${label} rating must be null or an integer from 1 to 5.`);
      }

      if (entry.year !== null && !isInt4(entry.year)) {
        pushError(errors, `${label} year must be null or a 32-bit integer.`);
      }
      if (entry.pageCount !== null && !isInt4(entry.pageCount)) {
        pushError(errors, `${label} pageCount must be null or a 32-bit integer.`);
      }
      if (typeof entry.isExample !== "boolean") {
        pushError(errors, `${label} isExample must be true or false.`);
      }
      if (!isCanonicalTimestamp(entry.createdAt)) {
        pushError(errors, `${label} createdAt must be a UTC timestamp with milliseconds.`);
      }
      if (!isCanonicalTimestamp(entry.updatedAt)) {
        pushError(errors, `${label} updatedAt must be a UTC timestamp with milliseconds.`);
      }

      const isbn = canonicalIsbn(text.isbn ?? "");
      if (isbn === null) {
        pushError(errors, `${label} ISBN must be empty or a valid ISBN-10 or ISBN-13.`);
      }

      if (errors.length > MAX_ERRORS) return;

      books.push({
        id,
        title: text.title ?? "",
        author: text.author ?? "",
        category: text.category ?? "",
        status,
        rating: typeof entry.rating === "number" ? entry.rating : null,
        notes: text.notes ?? "",
        isbn: isbn ?? "",
        year: typeof entry.year === "number" ? entry.year : null,
        publisher: text.publisher ?? "",
        pageCount: typeof entry.pageCount === "number" ? entry.pageCount : null,
        coverUrl: text.coverUrl ?? "",
        description: text.description ?? "",
        isExample: entry.isExample === true,
        createdAt: typeof entry.createdAt === "string" ? entry.createdAt : "",
        updatedAt: typeof entry.updatedAt === "string" ? entry.updatedAt : "",
      });
    });
  }

  const appState: Record<string, string> = {};
  if (!isPlainObject(data.appState)) {
    pushError(errors, "appState must be an object.");
  } else {
    const keys = Object.keys(data.appState);
    if (keys.length > MAX_APP_STATE_KEYS) {
      pushError(errors, `appState has ${keys.length} keys, above the limit of ${MAX_APP_STATE_KEYS}.`);
    }
    for (const key of keys) {
      if (!key.trim() || key.length > 200) {
        pushError(errors, "appState keys must be non-empty and at most 200 characters.");
        continue;
      }
      if (key === "__proto__" || key === "constructor" || key === "prototype") {
        pushError(errors, `appState key "${key}" is not allowed.`);
        continue;
      }
      if (isSecretAppStateKey(key)) {
        pushError(
          errors,
          `appState key "${key}" looks like a secret. Secrets are not imported.`,
        );
        continue;
      }
      const value = data.appState[key];
      if (typeof value !== "string" || value.length > 20_000) {
        pushError(errors, `appState "${key}" must be a string of at most 20000 characters.`);
        continue;
      }
      appState[key] = value;
    }
  }

  let note = "";
  let omittedSecretKeys: string[] = [];
  if (!isPlainObject(data.metadata)) {
    pushError(errors, "metadata must be an object.");
  } else {
    for (const key of Object.keys(data.metadata)) {
      if (!METADATA_FIELDS.includes(key as (typeof METADATA_FIELDS)[number])) {
        pushError(errors, `Unsupported metadata field "${key}".`);
      }
    }
    if (data.metadata.bookCount !== (Array.isArray(data.books) ? data.books.length : -1)) {
      pushError(errors, "metadata.bookCount must match the number of books.");
    }
    if (typeof data.metadata.note !== "string" || data.metadata.note.length > 2_000) {
      pushError(errors, "metadata.note must be a string of at most 2000 characters.");
    } else {
      note = data.metadata.note;
    }
    if (data.metadata.omittedSecretKeys === undefined) {
      omittedSecretKeys = [];
    } else if (
      !Array.isArray(data.metadata.omittedSecretKeys) ||
      data.metadata.omittedSecretKeys.some((key) => typeof key !== "string")
    ) {
      pushError(errors, "metadata.omittedSecretKeys must be an array of strings.");
    } else {
      omittedSecretKeys = data.metadata.omittedSecretKeys;
    }
  }

  if (Array.isArray(data.books) && data.books.length === 0) {
    warnings.push(
      "This backup contains zero books. Restoring it leaves the shelf with no books.",
    );
  }

  if (errors.length > 0) {
    return { valid: false, errors, warnings };
  }

  const backup: BackupData = {
    version: BACKUP_VERSION,
    createdAt: data.createdAt as string,
    books,
    appState,
    metadata: {
      bookCount: books.length,
      note,
      omittedSecretKeys,
    },
  };

  return {
    valid: true,
    errors,
    warnings,
    backup,
    preview: {
      version: BACKUP_VERSION,
      createdAt: backup.createdAt,
      bookCount: books.length,
      appStateCount: Object.keys(appState).length,
      exampleBookCount: books.filter((book) => book.isExample).length,
    },
  };
}

export function publicValidation(result: ValidationResult): Omit<ValidationResult, "backup"> {
  return {
    valid: result.valid,
    errors: result.errors,
    warnings: result.warnings,
    preview: result.preview,
  };
}

export async function getDestinationCounts(ownerId: string): Promise<DestinationCounts> {
  const books = await query<{ n: number | string }>(
    "SELECT COUNT(*)::int AS n FROM books WHERE owner_id = $1",
    [ownerId],
  );
  const state = await query<{ n: number | string }>(
    "SELECT COUNT(*)::int AS n FROM user_settings WHERE user_id = $1",
    [ownerId],
  );
  return {
    bookCount: Number(books.rows[0]?.n ?? 0),
    appStateCount: Number(state.rows[0]?.n ?? 0),
  };
}

export function destinationNeedsReplace(counts: DestinationCounts): boolean {
  return counts.bookCount > 0 || counts.appStateCount > 0;
}

export async function readJsonLimited(request: Request): Promise<unknown> {
  const declared = request.headers.get("content-length");
  if (declared && Number(declared) > MAX_BACKUP_BYTES) {
    throw new BackupRejected(
      413,
      `Backup file is too large (maximum ${MAX_BACKUP_BYTES} bytes).`,
    );
  }
  const text = await request.text();
  if (Buffer.byteLength(text) > MAX_BACKUP_BYTES) {
    throw new BackupRejected(
      413,
      `Backup file is too large (maximum ${MAX_BACKUP_BYTES} bytes).`,
    );
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new BackupRejected(400, "Backup file is not valid JSON.");
  }
}

async function countsOn(
  client: {
    query: (
      text: string,
      params?: unknown[],
    ) => Promise<{ rows: Array<{ n: number | string }> }>;
  },
  ownerId: string,
): Promise<DestinationCounts> {
  const books = await client.query(
    "SELECT COUNT(*)::int AS n FROM books WHERE owner_id = $1",
    [ownerId],
  );
  const state = await client.query(
    "SELECT COUNT(*)::int AS n FROM user_settings WHERE user_id = $1",
    [ownerId],
  );
  return {
    bookCount: Number(books.rows[0]?.n ?? 0),
    appStateCount: Number(state.rows[0]?.n ?? 0),
  };
}

export async function restoreBackup(
  input: unknown,
  options: { replace: boolean; ownerId: string },
): Promise<{ books: number; appState: number }> {
  const validation = validateBackupData(input);
  if (!validation.valid || !validation.backup) {
    throw new BackupInvalidError(validation.errors);
  }
  const backup = validation.backup;

  await query("SELECT 1");
  const client = await getPool().connect();
  let released = false;
  const release = (destroy?: Error) => {
    if (released) return;
    released = true;
    client.release(destroy);
  };
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL statement_timeout = '30s'");
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [options.ownerId]);
    await client.query("SELECT id FROM books WHERE owner_id = $1 FOR UPDATE", [options.ownerId]);

    const existing = await countsOn(client, options.ownerId);
    if (destinationNeedsReplace(existing) && !options.replace) {
      throw new RestoreRefusedError(existing.bookCount, existing.appStateCount);
    }

    const keptSecrets = await client.query(
      "SELECT key, value FROM user_settings WHERE user_id = $1 ORDER BY key ASC",
      [options.ownerId],
    );
    await client.query("DELETE FROM books WHERE owner_id = $1", [options.ownerId]);
    await client.query("DELETE FROM user_settings WHERE user_id = $1", [options.ownerId]);

    for (const book of backup.books) {
      await client.query(
        `INSERT INTO books (
          id, title, author, category, status, rating, notes, isbn, year,
          publisher, page_count, cover_url, description, is_example, created_at, updated_at,
          owner_id
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17
        )`,
        [
          book.id,
          book.title,
          book.author,
          book.category,
          book.status,
          book.rating,
          book.notes,
          book.isbn,
          book.year,
          book.publisher,
          book.pageCount,
          book.coverUrl,
          book.description,
          book.isExample,
          book.createdAt,
          book.updatedAt,
          options.ownerId,
        ],
      );
    }

    const secretRows = (
      keptSecrets as { rows: Array<{ key: string; value: string }> }
    ).rows.filter((row) => isSecretAppStateKey(row.key));
    for (const row of secretRows) {
      await client.query(
        "INSERT INTO user_settings (user_id, key, value) VALUES ($1, $2, $3)",
        [options.ownerId, row.key, row.value],
      );
    }
    for (const [key, value] of Object.entries(backup.appState)) {
      await client.query(
        `INSERT INTO user_settings (user_id, key, value) VALUES ($1, $2, $3)
         ON CONFLICT (user_id, key) DO UPDATE SET value = EXCLUDED.value`,
        [options.ownerId, key, value],
      );
    }

    await client.query("COMMIT");
    release();
    return { books: backup.books.length, appState: Object.keys(backup.appState).length };
  } catch (error) {
    try {
      await client.query("ROLLBACK");
      release();
    } catch (rollbackError) {
      release(rollbackError instanceof Error ? rollbackError : new Error("rollback failed"));
    }
    throw error;
  }
}

export function backupFailure(error: unknown): { status: number; body: Record<string, unknown> } {
  if (error instanceof BackupRejected) {
    return { status: error.status, body: { error: error.message } };
  }
  if (error instanceof BackupInvalidError) {
    return { status: 400, body: { error: error.message, details: error.errors } };
  }
  if (error instanceof RestoreRefusedError) {
    return {
      status: 409,
      body: {
        error: error.message,
        destination: { bookCount: error.bookCount, appStateCount: error.appStateCount },
      },
    };
  }
  const message = error instanceof Error ? error.message : "Backup request failed";
  return { status: 500, body: { error: message } };
}
