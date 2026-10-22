import { coverPalette } from "@/lib/cover";
import type { Book } from "@/lib/types";

export function SpineShelf({ books }: { books: Book[] }) {
  if (books.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Nothing shelved yet. Add a book and it will land here.
      </p>
    );
  }

  return (
    <div className="flex items-end gap-3 overflow-x-auto pb-1" data-testid="spine-shelf">
      {books.map((book) => {
        const palette = coverPalette(book.title);
        return (
          <div
            key={book.id}
            className="flex h-28 w-8 shrink-0 items-center justify-center rounded-sm shadow-sm"
            style={{ background: palette.bg, color: palette.ink }}
            title={book.title}
          >
            <span
              className="max-h-24 max-w-24 truncate text-[10px] tracking-wide"
              style={{ writingMode: "vertical-rl", transform: "rotate(180deg)" }}
            >
              {book.title}
            </span>
          </div>
        );
      })}
    </div>
  );
}
