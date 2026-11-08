import { INVALID_ISBN_MESSAGE, deleteBook, getBook, updateBook } from "@/lib/books";
import { AuthError, assertSameOrigin, privateJson } from "@/lib/http";
import { requireUser } from "@/lib/session";
import type { BookInput } from "@/lib/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireUser();
    const { id } = await params;
    const book = await getBook(user.id, id);
    if (!book) return privateJson({ error: "Book not found" }, 404);
    return privateJson({ book });
  } catch (error) {
    if (error instanceof AuthError) return privateJson({ error: error.message }, error.status);
    const message = error instanceof Error ? error.message : "Failed to load book";
    return privateJson({ error: message }, 500);
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    assertSameOrigin(request);
    const user = await requireUser();
    const { id } = await params;
    const body = (await request.json()) as BookInput;
    const book = await updateBook(user.id, id, body);
    if (!book) return privateJson({ error: "Book not found" }, 404);
    return privateJson({ book });
  } catch (error) {
    if (error instanceof AuthError) return privateJson({ error: error.message }, error.status);
    const message = error instanceof Error ? error.message : "Failed to update book";
    const status =
      message === "Title is required" || message === INVALID_ISBN_MESSAGE ? 400 : 500;
    return privateJson({ error: message }, status);
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    assertSameOrigin(request);
    const user = await requireUser();
    const { id } = await params;
    const removed = await deleteBook(user.id, id);
    if (!removed) return privateJson({ error: "Book not found" }, 404);
    return privateJson({ ok: true });
  } catch (error) {
    if (error instanceof AuthError) return privateJson({ error: error.message }, error.status);
    const message = error instanceof Error ? error.message : "Failed to delete book";
    return privateJson({ error: message }, 500);
  }
}
