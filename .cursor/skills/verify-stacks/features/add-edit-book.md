# Add and edit a book

Add and edit lets a signed-in person save a book by hand or from an ISBN lookup, change its status and rating, see it after a reload, and delete it. A blank ISBN is stored blank. A valid ISBN-10 or ISBN-13 is stored as ISBN-13. Any other non-empty ISBN stays in the dialog with an error and is not saved.

## Sub-features

- `add-manual` saves a title without an ISBN.
- `add-invalid-isbn` keeps the dialog open and shows the ISBN error when the check digit fails.
- `add-isbn10` stores a valid ISBN-10 as ISBN-13.
- `add-lookup` fills the form from `GET /api/lookup?isbn=9780451524935` and saves that book.
- `edit-status-rating` sets Reading and 4 stars on the saved book.
- `edit-reload` shows the same status and rating after a full reload.
- `edit-delete` removes the book from the shelf and from `books`.

## How to get to it (user POV)

- Sign in, then choose the round **Add book** button (`aria-label="Add book"`, `data-testid="add-book"`).
- Or open a card (`data-testid="book-card"`) to edit that book.
- The dialog title is `Add a book` or `Edit book`.

## Driving it with Playwright

Preconditions:

- Doctor passed and account A is signed in (`signed-in-as` contains `alice@example.test`).
- The shelf can already contain the three example books. This journey adds `9780451524935` and removes it before the end.
- Lookup needs a live network path to Open Library and Google Books. There is no fixture catalog.

- **Manual add.** Click `add-book`. Fill `title-input` with `Shelf Card` and `author-input` with `Manual Author`. Click `save-book` (accessible name `Add to shelf`). The dialog closes and a heading `Shelf Card` is visible. `fetch("/api/books")` includes that title with an empty ISBN.
- **Lookup.** Click `add-book`. Fill `isbn-input` with `9780451524935`. Click `lookup-isbn`. Wait until `title-input` matches `/1984|nineteen/i` and `data-testid="lookup-note"` is visible. Screenshot the filled dialog, then click `save-book`. A card whose `data-title` is the imported title is visible. `/api/books` returns that title with ISBN `9780451524935`.
- **Edit.** Click that card. In the dialog named `Edit book`, `status-select` selects `reading` and `rating-star-4` (`aria-label="4 stars"`) is clicked. Click `save-book` (accessible name `Save changes`). The card's `status-badge` reads `Reading` and `rating-stars` has `aria-label="4 stars"`.
- **Reload.** `page.reload`. The same card still shows `Reading` and `4 stars`. SQL for that ISBN shows `status` `reading` and `rating` `4` on alice's `owner_id` only.
- **Delete.** Open the card, click `delete-book`, and wait until the card is detached. `/api/books` and `SELECT title FROM books WHERE isbn = '9780451524935'` no longer return it.
- **Invalid ISBN.** Click `add-book`. Fill `title-input` with `Bad Isbn Card` and `isbn-input` with `9780000000000`. Click `save-book`. `data-testid="form-error"` reads `Enter a valid ISBN-10 or ISBN-13, or leave ISBN blank.` The dialog named `Add a book` stays open. `SELECT count(*) FROM books WHERE title = 'Bad Isbn Card'` is 0. Close the dialog.
- **ISBN-10.** Click `add-book`. Fill `title-input` with `ISBN Ten Shelf` and `isbn-input` with `0451524934` (the ISBN-10 whose ISBN-13 is `9780451524935`). Click `save-book`. The heading `ISBN Ten Shelf` is visible. `/api/books` and `SELECT isbn FROM books WHERE title = 'ISBN Ten Shelf'` both return `9780451524935`. Open that card and click `delete-book` so the probe does not stay on the shelf.
- **Proof.** Save the lookup dialog screenshot, the edited card screenshot, the post-reload screenshot, the invalid-ISBN error, the `/api/books` JSON after edit, after delete, and after the ISBN-10 save, and the SQL rows. Put them in `artifacts/verify/<run-id>/add-edit-book/`.

## Gotchas

- `save-book` stays disabled while the request is in flight. Wait for the dialog to close, not for the button label alone.
- A title is required. An ISBN-only form does not save until lookup or typing fills the title.
- Save sends the ISBN as typed. The server keeps a blank ISBN blank and rewrites a valid ISBN-10 or ISBN-13 to a digits-only ISBN-13. A value that fails that check returns HTTP 400, `save-book` is enabled again, and the dialog stays open on `form-error`. The value in `books.isbn` is the ISBN-13, not the typed ISBN-10.
- Lookup that returns HTTP 404 sets `lookup-note` to the error and leaves the title blank. That is a failed lookup, not a successful add.
- Keyless Google Books often returns HTTP 429. Open Library can still fill the title. The note then says `Imported from Open Library.` The add still passes if the title and ISBN are right. The merge of both sources is the catalog-search feature, not this one.
- `npm run verify` also looks up `9780451524935` and then deletes it. Running it against this scratch database in the middle of this journey removes the book you are asserting.
- Delete is immediate. There is no second confirm button. Screenshot the shelf after the card is gone.
