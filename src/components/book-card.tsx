import { BookOpen, Check, Circle, Star } from "lucide-react";
import { BookCover } from "@/components/book-cover";
import { formatIsbn } from "@/lib/isbn";
import type { Book } from "@/lib/types";

const STATUS = {
  owned: { label: "Owned", Icon: Circle },
  reading: { label: "Reading", Icon: BookOpen },
  read: { label: "Read", Icon: Check },
} as const;

export function BookCard({ book, onOpen }: { book: Book; onOpen: () => void }) {
  const status = STATUS[book.status];

  return (
    <button
      type="button"
      onClick={onOpen}
      data-testid="book-card"
      data-title={book.title}
      data-status={book.status}
      data-category={book.category}
      className="flex w-full gap-3 rounded-2xl bg-white px-3 py-3 text-left shadow-sm ring-1 ring-black/4 transition hover:ring-black/10"
    >
      <BookCover
        title={book.title}
        coverUrl={book.coverUrl}
        className="h-[4.5rem] w-12 shrink-0 rounded-md"
      />
      <div className="min-w-0 flex-1">
        <h3 className="truncate text-base font-semibold tracking-tight">{book.title}</h3>
        <p className="truncate text-sm text-muted-foreground">
          {book.author || "Unknown author"}
          {book.year ? ` · ${book.year}` : ""}
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <span
            className="inline-flex items-center gap-1 rounded-full bg-stone-100 px-2 py-0.5 text-[11px] font-medium text-stone-700"
            data-testid="status-badge"
          >
            <status.Icon className="size-3" />
            {status.label}
          </span>
          {book.category ? (
            <span
              className="rounded-full bg-stone-100 px-2 py-0.5 text-[11px] font-medium text-stone-700"
              data-testid="category-chip"
            >
              {book.category}
            </span>
          ) : null}
          {book.rating ? (
            <span className="inline-flex items-center" data-testid="rating-stars" aria-label={`${book.rating} stars`}>
              {Array.from({ length: 5 }, (_, index) => (
                <Star
                  key={index}
                  className={`size-3 ${index < book.rating! ? "fill-amber-400 text-amber-400" : "text-stone-300"}`}
                />
              ))}
            </span>
          ) : null}
        </div>
        {book.isbn ? (
          <p className="mt-1.5 text-[11px] tracking-wide text-stone-400">
            ISBN {formatIsbn(book.isbn)}
          </p>
        ) : null}
      </div>
    </button>
  );
}
