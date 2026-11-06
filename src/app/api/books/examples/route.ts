import { removeExampleBooks } from "@/lib/books";
import { AuthError, assertSameOrigin, privateJson } from "@/lib/http";
import { requireUser } from "@/lib/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function DELETE(request: Request) {
  try {
    assertSameOrigin(request);
    const user = await requireUser();
    const removed = await removeExampleBooks(user.id);
    return privateJson({ removed });
  } catch (error) {
    if (error instanceof AuthError) return privateJson({ error: error.message }, error.status);
    const message = error instanceof Error ? error.message : "Failed to remove examples";
    return privateJson({ error: message }, 500);
  }
}
