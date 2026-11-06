import { AuthError, privateJson } from "@/lib/http";
import { looksLikeIsbn, normalizeIsbn } from "@/lib/isbn";
import { lookupIsbn } from "@/lib/lookup";
import { requireUser } from "@/lib/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    await requireUser();
  } catch (error) {
    if (error instanceof AuthError) return privateJson({ error: error.message }, error.status);
    const message = error instanceof Error ? error.message : "Sign in required";
    return privateJson({ error: message }, 401);
  }

  const isbn = new URL(request.url).searchParams.get("isbn") ?? "";
  if (!looksLikeIsbn(isbn) || !normalizeIsbn(isbn)) {
    return privateJson({ error: "Enter a valid ISBN-10 or ISBN-13" }, 400);
  }

  try {
    const book = await lookupIsbn(isbn);
    if (!book) {
      return privateJson(
        { error: "No catalog match for that ISBN. You can still add it by hand." },
        404,
      );
    }
    return privateJson({ book });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Lookup failed";
    return privateJson({ error: message }, 502);
  }
}
