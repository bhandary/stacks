"use client";

import { useEffect, useState } from "react";
import { Star } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { Book, BookInput, BookLookup, BookStatus } from "@/lib/types";

const EMPTY: BookInput = {
  title: "",
  author: "",
  category: "",
  status: "owned",
  rating: null,
  notes: "",
  isbn: "",
  year: null,
  publisher: "",
  pageCount: null,
  coverUrl: "",
  description: "",
};

function fromBook(book: Book): BookInput {
  return {
    title: book.title,
    author: book.author,
    category: book.category,
    status: book.status,
    rating: book.rating,
    notes: book.notes,
    isbn: book.isbn,
    year: book.year,
    publisher: book.publisher,
    pageCount: book.pageCount,
    coverUrl: book.coverUrl,
    description: book.description,
  };
}

export function BookForm({
  open,
  book,
  preset,
  onOpenChange,
  onSaved,
  onDeleted,
}: {
  open: boolean;
  book: Book | null;
  preset?: BookInput | null;
  onOpenChange: (open: boolean) => void;
  onSaved: (book: Book) => void;
  onDeleted?: (id: string) => void;
}) {
  const [draft, setDraft] = useState<BookInput>(EMPTY);
  const [busy, setBusy] = useState(false);
  const [lookupBusy, setLookupBusy] = useState(false);
  const [error, setError] = useState("");
  const [lookupNote, setLookupNote] = useState("");

  useEffect(() => {
    if (!open) return;
    setDraft(book ? fromBook(book) : preset ? { ...EMPTY, ...preset } : EMPTY);
    setError("");
    setLookupNote(preset?.title ? "Imported catalog details." : "");
    setBusy(false);
    setLookupBusy(false);
  }, [open, book, preset]);

  function setField<K extends keyof BookInput>(key: K, value: BookInput[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  async function lookup() {
    if (!draft.isbn?.trim()) {
      setLookupNote("Enter an ISBN first.");
      return;
    }
    setLookupBusy(true);
    setLookupNote("");
    setError("");
    try {
      const response = await fetch(`/api/lookup?isbn=${encodeURIComponent(draft.isbn)}`);
      const payload = await response.json();
      if (!response.ok) {
        setLookupNote(payload.error || "Lookup failed.");
        return;
      }
      const found = payload.book as BookLookup;
      setDraft((current) => ({
        ...current,
        title: found.title || current.title,
        author: found.author || current.author,
        category: found.category || current.category,
        isbn: found.isbn || current.isbn,
        year: found.year ?? current.year,
        publisher: found.publisher || current.publisher,
        pageCount: found.pageCount ?? current.pageCount,
        coverUrl: found.coverUrl || current.coverUrl,
        description: found.description || current.description,
      }));
      setLookupNote(
        found.sources.length
          ? `Imported from ${found.sources.join(" + ")}.`
          : "Imported catalog details.",
      );
    } catch {
      setLookupNote("Lookup failed. Check the network and try again.");
    } finally {
      setLookupBusy(false);
    }
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const response = await fetch(book ? `/api/books/${book.id}` : "/api/books", {
        method: book ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...draft, isExample: false }),
      });
      const payload = await response.json();
      if (!response.ok) {
        setError(payload.error || "Could not save that book.");
        return;
      }
      onSaved(payload.book as Book);
      onOpenChange(false);
    } catch {
      setError("Could not save that book.");
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!book) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/books/${book.id}`, { method: "DELETE" });
      if (!response.ok) {
        const payload = await response.json();
        setError(payload.error || "Could not delete that book.");
        return;
      }
      onDeleted?.(book.id);
      onOpenChange(false);
    } catch {
      setError("Could not delete that book.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{book ? "Edit book" : "Add a book"}</DialogTitle>
          <DialogDescription>
            {book
              ? "Update the details on this shelf copy."
              : "Look up an ISBN or type the details yourself."}
          </DialogDescription>
        </DialogHeader>
        <form className="grid gap-3" onSubmit={save}>
          <div className="grid gap-1.5">
            <Label htmlFor="isbn">ISBN</Label>
            <div className="flex gap-2">
              <Input
                id="isbn"
                data-testid="isbn-input"
                value={draft.isbn ?? ""}
                onChange={(event) => setField("isbn", event.target.value)}
                placeholder="978..."
                inputMode="numeric"
              />
              <Button
                type="button"
                variant="outline"
                data-testid="lookup-isbn"
                onClick={lookup}
                disabled={lookupBusy}
              >
                {lookupBusy ? "Looking…" : "Lookup"}
              </Button>
            </div>
            {lookupNote ? (
              <p className="text-xs text-muted-foreground" data-testid="lookup-note">
                {lookupNote}
              </p>
            ) : null}
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="title">Title</Label>
            <Input
              id="title"
              data-testid="title-input"
              required
              value={draft.title}
              onChange={(event) => setField("title", event.target.value)}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="author">Author</Label>
            <Input
              id="author"
              data-testid="author-input"
              value={draft.author ?? ""}
              onChange={(event) => setField("author", event.target.value)}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="category">Category</Label>
            <Input
              id="category"
              data-testid="category-input"
              value={draft.category ?? ""}
              onChange={(event) => setField("category", event.target.value)}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="status">Status</Label>
              <select
                id="status"
                data-testid="status-select"
                className="h-8 rounded-lg border border-input bg-background px-2.5 text-sm"
                value={draft.status ?? "owned"}
                onChange={(event) => setField("status", event.target.value as BookStatus)}
              >
                <option value="owned">Owned</option>
                <option value="reading">Reading</option>
                <option value="read">Read</option>
              </select>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="year">Year</Label>
              <Input
                id="year"
                data-testid="year-input"
                inputMode="numeric"
                value={draft.year ?? ""}
                onChange={(event) =>
                  setField("year", event.target.value ? Number(event.target.value) : null)
                }
              />
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label>Rating</Label>
            <div className="flex items-center gap-1" data-testid="rating-picker">
              {Array.from({ length: 5 }, (_, index) => {
                const value = index + 1;
                const active = (draft.rating ?? 0) >= value;
                return (
                  <button
                    key={value}
                    type="button"
                    data-testid={`rating-star-${value}`}
                    aria-label={`${value} star${value === 1 ? "" : "s"}`}
                    className="rounded-md p-1"
                    onClick={() => setField("rating", draft.rating === value ? null : value)}
                  >
                    <Star
                      className={`size-5 ${active ? "fill-amber-400 text-amber-400" : "text-stone-300"}`}
                    />
                  </button>
                );
              })}
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="notes">Notes</Label>
            <Textarea
              id="notes"
              data-testid="notes-input"
              value={draft.notes ?? ""}
              onChange={(event) => setField("notes", event.target.value)}
              rows={3}
            />
          </div>
          {error ? (
            <p className="text-sm text-destructive" data-testid="form-error">
              {error}
            </p>
          ) : null}
          <div className="sticky bottom-0 flex items-center justify-between gap-2 border-t bg-popover pt-3">
            {book ? (
              <Button
                type="button"
                variant="destructive"
                data-testid="delete-book"
                onClick={remove}
                disabled={busy}
              >
                Delete
              </Button>
            ) : (
              <span />
            )}
            <Button type="submit" data-testid="save-book" disabled={busy}>
              {busy ? "Saving…" : book ? "Save changes" : "Add to shelf"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
