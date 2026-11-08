import { EXAMPLE_BOOKS } from "./examples";
import { getPool, query } from "./db";
import { normalizeIsbn } from "./isbn";
import {
  BOOK_STATUSES,
  type Book,
  type BookInput,
  type BookStatus,
} from "./types";

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

export type BookFilter = {
  q?: string;
  status?: string;
  category?: string;
};

export type ShelfStats = {
  total: number;
  filtered: number;
  authors: number;
  categories: number;
  byStatus: Record<BookStatus, number>;
};

function mapBook(row: BookRow): Book {
  return {
    id: row.id,
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

function cleanText(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value.trim() : fallback;
}

function cleanRating(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1 || n > 5) return null;
  return n;
}

function cleanYear(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1000 || n > 3000) return null;
  return n;
}

function cleanPageCount(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1 || n > 100000) return null;
  return n;
}

function cleanStatus(value: unknown): BookStatus {
  return BOOK_STATUSES.includes(value as BookStatus)
    ? (value as BookStatus)
    : "owned";
}

export const INVALID_ISBN_MESSAGE =
  "Enter a valid ISBN-10 or ISBN-13, or leave ISBN blank.";

/** Empty stays empty. A non-empty value must pass `normalizeIsbn` and is returned as ISBN-13. */
export function canonicalIsbn(value: unknown): string | null {
  if (value == null || value === "") return "";
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return "";
  return normalizeIsbn(trimmed);
}

export function normalizeBookInput(input: BookInput): BookInput {
  const isbn = canonicalIsbn(input.isbn);
  if (isbn === null) {
    throw new Error(INVALID_ISBN_MESSAGE);
  }
  return {
    title: cleanText(input.title),
    author: cleanText(input.author),
    category: cleanText(input.category),
    status: cleanStatus(input.status),
    rating: cleanRating(input.rating),
    notes: cleanText(input.notes),
    isbn,
    year: cleanYear(input.year),
    publisher: cleanText(input.publisher),
    pageCount: cleanPageCount(input.pageCount),
    coverUrl: cleanText(input.coverUrl),
    description: cleanText(input.description),
    isExample: Boolean(input.isExample),
  };
}

const INSERT_SQL = `INSERT INTO books (
  title, author, category, status, rating, notes, isbn, year,
  publisher, page_count, cover_url, description, is_example, owner_id
) VALUES (
  $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14
) RETURNING *`;

function insertParams(book: BookInput, ownerId: string): unknown[] {
  return [
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
    book.isExample ?? false,
    ownerId,
  ];
}

export async function seedExamplesIfNeeded(ownerId: string): Promise<void> {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [ownerId]);
    const seeded = await client.query(
      "SELECT value FROM user_settings WHERE user_id = $1 AND key = 'examples_seeded'",
      [ownerId],
    );
    if ((seeded.rowCount ?? 0) > 0) {
      await client.query("COMMIT");
      return;
    }
    const count = await client.query<{ n: string }>(
      "SELECT COUNT(*)::text AS n FROM books WHERE owner_id = $1",
      [ownerId],
    );
    if (Number(count.rows[0]?.n ?? 0) === 0) {
      for (const example of EXAMPLE_BOOKS) {
        const book = normalizeBookInput(example);
        await client.query(INSERT_SQL, insertParams(book, ownerId));
      }
    }
    await client.query(
      `INSERT INTO user_settings (user_id, key, value)
       VALUES ($1, 'examples_seeded', '1')
       ON CONFLICT (user_id, key) DO NOTHING`,
      [ownerId],
    );
    await client.query("COMMIT");
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // The original error is the one that matters.
    }
    throw error;
  } finally {
    client.release();
  }
}

export async function listBooks(
  ownerId: string,
  filter: BookFilter = {},
): Promise<{ books: Book[]; stats: ShelfStats }> {
  await seedExamplesIfNeeded(ownerId);
  const result = await query<BookRow>(
    "SELECT * FROM books WHERE owner_id = $1 ORDER BY created_at DESC",
    [ownerId],
  );
  const all = result.rows.map(mapBook);
  const status = BOOK_STATUSES.includes(filter.status as BookStatus)
    ? (filter.status as BookStatus)
    : undefined;
  const category = filter.category?.trim() || "";
  const needle = filter.q?.trim().toLowerCase() || "";
  const books = all.filter((book) => {
    if (status && book.status !== status) return false;
    if (category && book.category !== category) return false;
    if (!needle) return true;
    return [book.title, book.author, book.isbn, book.category]
      .join(" ")
      .toLowerCase()
      .includes(needle);
  });
  const byStatus: Record<BookStatus, number> = { owned: 0, reading: 0, read: 0 };
  for (const book of all) byStatus[book.status] += 1;
  return {
    books,
    stats: {
      total: all.length,
      filtered: books.length,
      authors: new Set(all.map((book) => book.author).filter(Boolean)).size,
      categories: new Set(all.map((book) => book.category).filter(Boolean)).size,
      byStatus,
    },
  };
}

export async function getBook(ownerId: string, id: string): Promise<Book | null> {
  const result = await query<BookRow>(
    "SELECT * FROM books WHERE id = $1 AND owner_id = $2",
    [id, ownerId],
  );
  return result.rows[0] ? mapBook(result.rows[0]) : null;
}

export async function insertBook(ownerId: string, input: BookInput): Promise<Book> {
  const book = normalizeBookInput(input);
  if (!book.title) {
    throw new Error("Title is required");
  }
  const result = await query<BookRow>(INSERT_SQL, insertParams(book, ownerId));
  return mapBook(result.rows[0]);
}

export async function updateBook(
  ownerId: string,
  id: string,
  input: BookInput,
): Promise<Book | null> {
  const existing = await getBook(ownerId, id);
  if (!existing) return null;
  const book = normalizeBookInput({ ...existing, ...input });
  if (!book.title) {
    throw new Error("Title is required");
  }
  const result = await query<BookRow>(
    `UPDATE books SET
      title = $3,
      author = $4,
      category = $5,
      status = $6,
      rating = $7,
      notes = $8,
      isbn = $9,
      year = $10,
      publisher = $11,
      page_count = $12,
      cover_url = $13,
      description = $14,
      is_example = $15,
      updated_at = NOW()
    WHERE id = $1 AND owner_id = $2
    RETURNING *`,
    [
      id,
      ownerId,
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
      book.isExample ?? existing.isExample,
    ],
  );
  return result.rows[0] ? mapBook(result.rows[0]) : null;
}

export async function deleteBook(ownerId: string, id: string): Promise<boolean> {
  const result = await query("DELETE FROM books WHERE id = $1 AND owner_id = $2", [id, ownerId]);
  return (result.rowCount ?? 0) > 0;
}

export async function removeExampleBooks(ownerId: string): Promise<number> {
  const result = await query(
    "DELETE FROM books WHERE is_example = TRUE AND owner_id = $1",
    [ownerId],
  );
  return result.rowCount ?? 0;
}
