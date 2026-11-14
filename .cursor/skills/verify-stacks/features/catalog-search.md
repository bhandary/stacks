# Catalog lookup and shelf search

Catalog lookup fills one form from Google Books and Open Library, preferring Google's value for each field when both answered. Search, status, category, and sort narrow the cards already on the shelf. The search box matches title, author, ISBN, and category.

## Sub-features

- `catalog-merge` looks up `9780141439518` and records which sources came back.
- `search-title` narrows the shelf to The Hobbit.
- `search-author` narrows it to Andy Weir's book.
- `search-isbn` narrows it to Sapiens by ISBN.
- `search-empty` shows the empty state for a query that matches nothing.
- `search-category` matches a category word from the search box.
- `filter-status` shows Reading books.
- `filter-category` shows Fiction.
- `sort-title` orders the visible cards by title.

## How to get to it (user POV)

- Sign in and choose **Add book**, enter an ISBN, and choose **Lookup**.
- Or use the search box on the shelf (`placeholder="Search title, author, ISBN…"`, `data-testid="search"`).
- The three selects are `filter-category`, `filter-status`, and `filter-sort`.

## Driving it with Playwright

Preconditions:

- Doctor passed and account A is on a shelf that still has the seeded examples: Project Hail Mary (Owned, Science Fiction, Andy Weir, ISBN `9780593135204`), Sapiens (Reading, History, Yuval Noah Harari, ISBN `9780062316097`), and The Hobbit (Read, Fiction, J.R.R. Tolkien, 5 stars, ISBN `9780547928227`).
- If those three headings are absent, stop. The seed did not run. Do not insert the rows by SQL to make the filters pass.
- Catalog merge needs the live Google Books and Open Library endpoints.

- **Merge.** Click `add-book`. Fill `isbn-input` with `9780141439518`. Click `lookup-isbn`. Wait until `title-input` matches `/pride|prejudice|austen/i`. Read `lookup-note`. A merged result says `Imported from Google Books + Open Library.` Screenshot the dialog and save the note text. `GET /api/lookup?isbn=9780141439518` with the session cookie returns the same title and a `sources` array. Close the dialog with the Close button or Escape so this sub-feature does not save a book. The add form has no Cancel button. If the note names only one source, this sub-feature fails. The usual cause is Google Books HTTP 429 on a keyless request; the server log line `fetch www.googleapis.com/books/v1/volumes failed` is the evidence. Do not change the expected note to the single source that happened to answer.
- **Title search.** Fill `search` with `hobbit`. The only `book-card` has `data-title="The Hobbit"`.
- **Author search.** Fill `search` with `weir`. The only card is `Project Hail Mary`.
- **ISBN search.** Fill `search` with `9780062316097`. The only card is `Sapiens`.
- **Empty.** Fill `search` with `zzzz-no-book`. `data-testid="empty-state"` is visible and `book-card` count is 0. Clear the box. All three cards return.
- **Category text.** Fill `search` with `history`. The only card is `Sapiens`. The box matches category as well as title, author, and ISBN. Clear the box before the status filter.
- **Status.** `filter-status` selects `reading`. The only card is `Sapiens` with `data-status="reading"`. Select `all` again.
- **Category.** `filter-category` selects `Fiction`. The only card is `The Hobbit`. Select `all`.
- **Sort.** `filter-sort` selects `title`. The `data-title` values from top to bottom are `Project Hail Mary`, `Sapiens`, `The Hobbit`.
- **Proof.** Screenshots of the lookup note, the Hobbit search, the empty state, and the Reading filter, plus the `/api/lookup` JSON and a SQL `SELECT title FROM books WHERE owner_id = ...` showing the three examples unchanged. Search does not write. Files go in `artifacts/verify/<run-id>/catalog-search/`.

## Gotchas

- The search box filters cards in the browser. It does not request `/api/books?q=`. An empty network log during search is expected. `/api/books?q=` is a different entry point and is not what the box does. The matched fields are title, author, ISBN, and category. The placeholder names the first three.
- The add-book dialog closes with the Close button or Escape. It has no Cancel button.
- Category options are built from the books on the shelf. `Fiction` is absent until The Hobbit has loaded.
- Sort is client-side among the cards that already passed the search and filters. Clear the search before asserting title order.
- Google Books is preferred field by field (`pick` keeps the Google value when it is non-empty). A merged note can still show an Open Library cover only when Google sent no cover. Assert the note text and the title, not a specific cover host.
- `npm run check:lookup` replaces `fetch` and never contacts those hosts. A pass there does not prove `catalog-merge`.
