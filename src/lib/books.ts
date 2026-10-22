import { EXAMPLE_BOOKS } from "./examples";
import { query } from "./db";
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

export function normalizeBookInput(input: BookInput): BookInput {
  const isbn = input.isbn ? normalizeIsbn(input.isbn) || digitsKeep(input.isbn) : "";
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

function digitsKeep(value: string): string {
  return value.replace(/[^0-9Xx]/g, "").toUpperCase();
}

export async function seedExamplesIfNeeded(): Promise<void> {
  const seeded = await query<{ value: string }>(
    "SELECT value FROM app_state WHERE key = 'examples_seeded'",
  );
  if (seeded.rowCount) return;

  const count = await query<{ n: string }>("SELECT COUNT(*)::text AS n FROM books");
  if (Number(count.rows[0]?.n ?? 0) === 0) {
    for (const book of EXAMPLE_BOOKS) {
      await insertBook(book);
    }
  }

  await query(
    "INSERT INTO app_state (key, value) VALUES ('examples_seeded', '1') ON CONFLICT (key) DO NOTHING",
  );
}

export async function listBooks(): Promise<Book[]> {
  await seedExamplesIfNeeded();
  const result = await query<BookRow>(
    "SELECT * FROM books ORDER BY created_at DESC",
  );
  return result.rows.map(mapBook);
}

export async function getBook(id: string): Promise<Book | null> {
  const result = await query<BookRow>("SELECT * FROM books WHERE id = $1", [id]);
  return result.rows[0] ? mapBook(result.rows[0]) : null;
}

export async function insertBook(input: BookInput): Promise<Book> {
  const book = normalizeBookInput(input);
  if (!book.title) {
    throw new Error("Title is required");
  }
  const result = await query<BookRow>(
    `INSERT INTO books (
      title, author, category, status, rating, notes, isbn, year,
      publisher, page_count, cover_url, description, is_example
    ) VALUES (
      $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13
    ) RETURNING *`,
    [
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
    ],
  );
  return mapBook(result.rows[0]);
}

export async function updateBook(id: string, input: BookInput): Promise<Book | null> {
  const existing = await getBook(id);
  if (!existing) return null;
  const book = normalizeBookInput({ ...existing, ...input });
  if (!book.title) {
    throw new Error("Title is required");
  }
  const result = await query<BookRow>(
    `UPDATE books SET
      title = $2,
      author = $3,
      category = $4,
      status = $5,
      rating = $6,
      notes = $7,
      isbn = $8,
      year = $9,
      publisher = $10,
      page_count = $11,
      cover_url = $12,
      description = $13,
      is_example = $14,
      updated_at = NOW()
    WHERE id = $1
    RETURNING *`,
    [
      id,
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

export async function deleteBook(id: string): Promise<boolean> {
  const result = await query("DELETE FROM books WHERE id = $1", [id]);
  return (result.rowCount ?? 0) > 0;
}

export async function removeExampleBooks(): Promise<number> {
  const result = await query("DELETE FROM books WHERE is_example = TRUE");
  return result.rowCount ?? 0;
}
