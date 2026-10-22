import { NextResponse } from "next/server";
import { removeExampleBooks } from "@/lib/books";

export const dynamic = "force-dynamic";

export async function DELETE() {
  try {
    const removed = await removeExampleBooks();
    return NextResponse.json({ removed });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to remove examples";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
