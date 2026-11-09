import { AuthError, assertSameOrigin, privateJson } from "@/lib/http";
import { INVALID_ISBN_MESSAGE, insertBook, listBooks } from "@/lib/books";
import { requireUser } from "@/lib/session";
import { BOOK_STATUSES, type BookInput, type BookStatus } from "@/lib/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const user = await requireUser();
    const url = new URL(request.url);
    const status = url.searchParams.get("status") ?? "";
    const category = url.searchParams.get("category") ?? "";
    const q = url.searchParams.get("q") ?? "";
    if (status && !BOOK_STATUSES.includes(status as BookStatus)) {
      return privateJson({ error: "Status must be owned, reading, or read" }, 400);
    }
    if (q.length > 200 || category.length > 200) {
      return privateJson({ error: "Search is too long" }, 400);
    }
    const shelf = await listBooks(user.id, {
      q,
      status,
      category,
    });
    return privateJson(shelf);
  } catch (error) {
    if (error instanceof AuthError) return privateJson({ error: error.message }, error.status);
    const message = error instanceof Error ? error.message : "Failed to load books";
    return privateJson({ error: message }, 500);
  }
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const user = await requireUser();
    const body = (await request.json()) as BookInput;
    const book = await insertBook(user.id, body);
    return privateJson({ book }, 201);
  } catch (error) {
    if (error instanceof AuthError) return privateJson({ error: error.message }, error.status);
    const message = error instanceof Error ? error.message : "Failed to add book";
    const status =
      message === "Title is required" || message === INVALID_ISBN_MESSAGE ? 400 : 500;
    return privateJson({ error: message }, status);
  }
}
