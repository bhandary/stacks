"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { MoreHorizontal, Plus, ScanBarcode, Search } from "lucide-react";
import { BookCard } from "@/components/book-card";
import { BookForm } from "@/components/book-form";
import { ScanIsbn } from "@/components/scan-isbn";
import { SpineShelf } from "@/components/spine-shelf";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import type { Book, BookInput, BookLookup } from "@/lib/types";

type SortKey = "newest" | "oldest" | "title" | "author" | "rating";

export function Library() {
  const [books, setBooks] = useState<Book[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("all");
  const [status, setStatus] = useState("all");
  const [sort, setSort] = useState<SortKey>("newest");
  const [formOpen, setFormOpen] = useState(false);
  const [scanOpen, setScanOpen] = useState(false);
  const [editing, setEditing] = useState<Book | null>(null);
  const [preset, setPreset] = useState<BookInput | null>(null);
  const [importing, setImporting] = useState(false);

  const load = useCallback(async () => {
    setError("");
    try {
      const response = await fetch("/api/books");
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Failed to load books");
      setBooks(payload.books as Book[]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Failed to load books");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const categories = useMemo(() => {
    return Array.from(new Set(books.map((book) => book.category).filter(Boolean))).sort();
  }, [books]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const next = books.filter((book) => {
      if (category !== "all" && book.category !== category) return false;
      if (status !== "all" && book.status !== status) return false;
      if (!needle) return true;
      return [book.title, book.author, book.isbn, book.category]
        .join(" ")
        .toLowerCase()
        .includes(needle);
    });
    next.sort((a, b) => {
      if (sort === "oldest") return a.createdAt.localeCompare(b.createdAt);
      if (sort === "title") return a.title.localeCompare(b.title);
      if (sort === "author") return a.author.localeCompare(b.author);
      if (sort === "rating") return (b.rating ?? 0) - (a.rating ?? 0);
      return b.createdAt.localeCompare(a.createdAt);
    });
    return next;
  }, [books, category, query, sort, status]);

  const authors = useMemo(
    () => new Set(books.map((book) => book.author).filter(Boolean)).size,
    [books],
  );
  const examples = books.some((book) => book.isExample);
  const recent = [...books]
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 8);

  function openAdd() {
    setEditing(null);
    setPreset(null);
    setFormOpen(true);
  }

  function openEdit(book: Book) {
    setEditing(book);
    setPreset(null);
    setFormOpen(true);
  }

  async function importIsbn(isbn: string) {
    setScanOpen(false);
    setImporting(true);
    setEditing(null);
    try {
      const response = await fetch(`/api/lookup?isbn=${encodeURIComponent(isbn)}`);
      const payload = await response.json();
      if (response.ok) {
        const found = payload.book as BookLookup;
        setPreset({
          title: found.title,
          author: found.author,
          category: found.category,
          status: "owned",
          isbn: found.isbn,
          year: found.year,
          publisher: found.publisher,
          pageCount: found.pageCount,
          coverUrl: found.coverUrl,
          description: found.description,
        });
      } else {
        setPreset({ title: "", author: "", isbn, status: "owned" });
      }
      setFormOpen(true);
    } finally {
      setImporting(false);
    }
  }

  async function removeExamples() {
    const response = await fetch("/api/books/examples", { method: "DELETE" });
    if (response.ok) await load();
  }

  return (
    <div className="mx-auto flex min-h-full w-full max-w-[430px] flex-1 flex-col bg-[#f3f5f2] px-4 pb-28 pt-5">
      <header className="flex items-start justify-between gap-3">
        <div>
          <h1 className="font-heading text-[2.35rem] leading-none tracking-tight">Stacks</h1>
          <p className="mt-2 text-sm text-stone-500" data-testid="counts">
            {books.length} {books.length === 1 ? "book" : "books"} · {authors}{" "}
            {authors === 1 ? "author" : "authors"} · {categories.length}{" "}
            {categories.length === 1 ? "category" : "categories"}
          </p>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger
            className="inline-flex size-9 items-center justify-center rounded-full bg-white text-stone-700 shadow-sm ring-1 ring-black/5"
            aria-label="Shelf menu"
            data-testid="shelf-menu"
          >
            <MoreHorizontal className="size-4" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              data-testid="remove-examples-menu"
              disabled={!examples}
              onClick={() => void removeExamples()}
            >
              Remove examples
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </header>

      <section className="mt-8">
        <p className="text-[11px] font-medium tracking-[0.16em] text-stone-400 uppercase">
          Recently shelved
        </p>
        <div className="mt-3">
          <SpineShelf books={recent} />
        </div>
      </section>

      {examples ? (
        <div
          className="mt-5 flex items-start justify-between gap-3 rounded-xl bg-[#e7f1e8] px-3 py-3 text-sm text-stone-700"
          data-testid="example-banner"
        >
          <p>These are example books. Scan your first book to start your own shelf.</p>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="shrink-0 text-stone-700"
            data-testid="remove-examples"
            onClick={() => void removeExamples()}
          >
            Remove examples
          </Button>
        </div>
      ) : null}

      <div className="relative mt-4">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-stone-400" />
        <Input
          data-testid="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search title, author, ISBN…"
          className="h-11 rounded-full bg-white pl-9 shadow-none"
        />
      </div>

      <div className="mt-3 grid grid-cols-3 gap-2">
        <select
          data-testid="filter-category"
          className="h-10 rounded-full border border-black/8 bg-white px-3 text-xs"
          value={category}
          onChange={(event) => setCategory(event.target.value)}
        >
          <option value="all">All categories</option>
          {categories.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
        <select
          data-testid="filter-status"
          className="h-10 rounded-full border border-black/8 bg-white px-3 text-xs"
          value={status}
          onChange={(event) => setStatus(event.target.value)}
        >
          <option value="all">Any status</option>
          <option value="owned">Owned</option>
          <option value="reading">Reading</option>
          <option value="read">Read</option>
        </select>
        <select
          data-testid="filter-sort"
          className="h-10 rounded-full border border-black/8 bg-white px-3 text-xs"
          value={sort}
          onChange={(event) => setSort(event.target.value as SortKey)}
        >
          <option value="newest">Newest first</option>
          <option value="oldest">Oldest first</option>
          <option value="title">Title A–Z</option>
          <option value="author">Author A–Z</option>
          <option value="rating">Highest rated</option>
        </select>
      </div>

      <section className="mt-4 flex flex-col gap-3" data-testid="book-list">
        {loading ? (
          <p className="py-10 text-center text-sm text-stone-500" data-testid="loading">
            Loading your shelf…
          </p>
        ) : error ? (
          <div className="rounded-2xl bg-white px-4 py-6 text-center shadow-sm">
            <p className="text-sm text-destructive" data-testid="load-error">
              {error}
            </p>
            <Button className="mt-3" variant="outline" onClick={() => void load()}>
              Try again
            </Button>
          </div>
        ) : filtered.length === 0 ? (
          <div className="rounded-2xl bg-white px-4 py-10 text-center shadow-sm" data-testid="empty-state">
            <p className="font-medium">Your shelf is empty</p>
            <p className="mt-1 text-sm text-stone-500">
              Add a book or scan an ISBN to start stacking.
            </p>
          </div>
        ) : (
          filtered.map((book) => (
            <BookCard key={book.id} book={book} onOpen={() => openEdit(book)} />
          ))
        )}
      </section>

      <div className="pointer-events-none fixed right-4 bottom-5 z-40 flex items-center gap-2">
        <Button
          type="button"
          data-testid="add-book"
          onClick={openAdd}
          className="pointer-events-auto size-12 rounded-full bg-white text-stone-900 shadow-lg ring-1 ring-black/10 hover:bg-white"
          size="icon"
          aria-label="Add book"
        >
          <Plus className="size-5" />
        </Button>
        <Button
          type="button"
          data-testid="scan-isbn"
          onClick={() => setScanOpen(true)}
          className="pointer-events-auto h-12 rounded-full bg-neutral-950 px-4 text-white shadow-lg hover:bg-neutral-800"
        >
          <ScanBarcode className="size-4" />
          Scan ISBN
        </Button>
      </div>

      {importing ? (
        <p className="fixed bottom-24 left-1/2 z-40 -translate-x-1/2 rounded-full bg-neutral-950 px-3 py-1 text-xs text-white">
          Importing catalog details…
        </p>
      ) : null}

      <BookForm
        open={formOpen}
        book={editing}
        preset={preset}
        onOpenChange={setFormOpen}
        onSaved={() => void load()}
        onDeleted={() => void load()}
      />
      <ScanIsbn
        open={scanOpen}
        onClose={() => setScanOpen(false)}
        onDetected={(isbn) => void importIsbn(isbn)}
      />
    </div>
  );
}
