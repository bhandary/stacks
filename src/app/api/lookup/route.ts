import { NextResponse } from "next/server";
import { lookupIsbn } from "@/lib/lookup";
import { looksLikeIsbn, normalizeIsbn } from "@/lib/isbn";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const isbn = new URL(request.url).searchParams.get("isbn") ?? "";
  if (!looksLikeIsbn(isbn) || !normalizeIsbn(isbn)) {
    return NextResponse.json({ error: "Enter a valid ISBN-10 or ISBN-13" }, { status: 400 });
  }

  try {
    const book = await lookupIsbn(isbn);
    if (!book) {
      return NextResponse.json(
        { error: "No catalog match for that ISBN. You can still add it by hand." },
        { status: 404 },
      );
    }
    return NextResponse.json({ book });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Lookup failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
