import { NextResponse } from "next/server";
import { deleteBook, updateBook } from "@/lib/books";
import type { BookInput } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const body = (await request.json()) as BookInput;
    const book = await updateBook(id, body);
    if (!book) {
      return NextResponse.json({ error: "Book not found" }, { status: 404 });
    }
    return NextResponse.json({ book });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to update book";
    const status = message === "Title is required" ? 400 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const removed = await deleteBook(id);
    if (!removed) {
      return NextResponse.json({ error: "Book not found" }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to delete book";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
