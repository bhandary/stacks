import { normalizeIsbn } from "./isbn";
import type { BookLookup } from "./types";

const FETCH_MS = 8000;

type PartialLookup = Partial<Omit<BookLookup, "isbn" | "sources">> & {
  sources?: string[];
};

function fetchLogTarget(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.host}${parsed.pathname}`;
  } catch {
    return "(invalid-url)";
  }
}

function redactSecrets(text: string): string {
  const key = process.env.GOOGLE_BOOKS_API_KEY;
  if (!key) return text;
  return text.split(key).join("[redacted]").split(encodeURIComponent(key)).join("[redacted]");
}

async function fetchJson(url: string): Promise<unknown | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_MS);
  const target = fetchLogTarget(url);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });
    if (!response.ok) {
      console.warn(`fetch ${target} failed: HTTP ${response.status}`);
      return null;
    }
    return await response.json();
  } catch (error) {
    const message = redactSecrets(error instanceof Error ? error.message : String(error));
    console.warn(`fetch ${target} error: ${message}`);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function googleBooksUrl(isbn: string): string {
  const base = `https://www.googleapis.com/books/v1/volumes?q=isbn:${isbn}`;
  const key = process.env.GOOGLE_BOOKS_API_KEY;
  if (!key) return base;
  return `${base}&key=${encodeURIComponent(key)}`;
}

function firstString(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function yearFrom(value: unknown): number | null {
  if (typeof value === "number" && Number.isInteger(value)) return value;
  if (typeof value !== "string") return null;
  const match = value.match(/\b(1[5-9]\d{2}|20\d{2}|2100)\b/);
  return match ? Number(match[1]) : null;
}

async function fromGoogleBooks(isbn: string): Promise<PartialLookup> {
  const data = (await fetchJson(googleBooksUrl(isbn))) as {
    items?: Array<{
      volumeInfo?: {
        title?: string;
        authors?: string[];
        categories?: string[];
        publishedDate?: string;
        publisher?: string;
        pageCount?: number;
        description?: string;
        imageLinks?: { thumbnail?: string; smallThumbnail?: string };
      };
    }>;
  } | null;

  const info = data?.items?.[0]?.volumeInfo;
  if (!info) return {};

  const cover = firstString(
    info.imageLinks?.thumbnail,
    info.imageLinks?.smallThumbnail,
  ).replace("http://", "https://");

  return {
    title: firstString(info.title),
    author: (info.authors ?? []).filter(Boolean).join(", "),
    category: firstString(info.categories?.[0]),
    year: yearFrom(info.publishedDate),
    publisher: firstString(info.publisher),
    pageCount: typeof info.pageCount === "number" ? info.pageCount : null,
    coverUrl: cover,
    description: firstString(info.description),
    sources: ["Google Books"],
  };
}

async function fromOpenLibrary(isbn: string): Promise<PartialLookup> {
  const data = (await fetchJson(
    `https://openlibrary.org/api/books?bibkeys=ISBN:${isbn}&format=json&jscmd=data`,
  )) as Record<
    string,
    {
      title?: string;
      authors?: Array<{ name?: string }>;
      subjects?: Array<{ name?: string }>;
      publish_date?: string;
      publishers?: Array<{ name?: string }>;
      number_of_pages?: number;
      cover?: { medium?: string; large?: string; small?: string };
      notes?: string;
      excerpts?: Array<{ text?: string }>;
    }
  > | null;

  const info = data?.[`ISBN:${isbn}`];
  if (!info) return {};

  const cover = firstString(
    info.cover?.large,
    info.cover?.medium,
    info.cover?.small,
    `https://covers.openlibrary.org/b/isbn/${isbn}-M.jpg`,
  );

  return {
    title: firstString(info.title),
    author: (info.authors ?? []).map((author) => author.name).filter(Boolean).join(", "),
    category: firstString(info.subjects?.[0]?.name),
    year: yearFrom(info.publish_date),
    publisher: firstString(info.publishers?.[0]?.name),
    pageCount: typeof info.number_of_pages === "number" ? info.number_of_pages : null,
    coverUrl: cover,
    description: firstString(info.notes, info.excerpts?.[0]?.text),
    sources: ["Open Library"],
  };
}

function pick(primary: string, secondary: string): string {
  return primary || secondary;
}

export async function lookupIsbn(rawIsbn: string): Promise<BookLookup | null> {
  const isbn = normalizeIsbn(rawIsbn);
  if (!isbn) return null;

  const [google, openLibrary] = await Promise.all([
    fromGoogleBooks(isbn),
    fromOpenLibrary(isbn),
  ]);

  const title = pick(google.title ?? "", openLibrary.title ?? "");
  if (!title) return null;

  const sources = [
    ...(google.title || google.author ? google.sources ?? [] : []),
    ...(openLibrary.title || openLibrary.author ? openLibrary.sources ?? [] : []),
  ];

  return {
    isbn,
    title,
    author: pick(google.author ?? "", openLibrary.author ?? ""),
    category: pick(google.category ?? "", openLibrary.category ?? ""),
    year: google.year ?? openLibrary.year ?? null,
    publisher: pick(google.publisher ?? "", openLibrary.publisher ?? ""),
    pageCount: google.pageCount ?? openLibrary.pageCount ?? null,
    coverUrl: pick(google.coverUrl ?? "", openLibrary.coverUrl ?? ""),
    description: pick(google.description ?? "", openLibrary.description ?? ""),
    sources,
  };
}
