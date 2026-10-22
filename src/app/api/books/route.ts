import { NextResponse } from "next/server";
import { insertBook, listBooks } from "@/lib/books";
import type { BookInput } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const books = await listBooks();
    return NextResponse.json({ books });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load books";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as BookInput;
    const book = await insertBook(body);
    return NextResponse.json({ book }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to add book";
    const status = message === "Title is required" ? 400 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
