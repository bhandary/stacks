import {
  BackupRejected,
  backupFailure,
  readJsonLimited,
  restoreBackup,
} from "@/lib/backup";
import { AuthError, assertSameOrigin, privateJson } from "@/lib/http";
import { requireUser } from "@/lib/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RestoreRequest = {
  confirm?: unknown;
  replace?: unknown;
  backup?: unknown;
};

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const user = await requireUser();
    const body = (await readJsonLimited(request)) as RestoreRequest;
    if (typeof body !== "object" || body === null || Array.isArray(body)) {
      throw new BackupRejected(400, "Restore request must be a JSON object.");
    }
    if (body.confirm !== true) {
      throw new BackupRejected(
        400,
        "Explicit confirmation is required before restore. No data was changed.",
      );
    }

    const restored = await restoreBackup(body.backup, {
      replace: body.replace === true,
      ownerId: user.id,
    });
    return privateJson({ success: true, restored });
  } catch (error) {
    if (error instanceof AuthError) return privateJson({ error: error.message }, error.status);
    const failure = backupFailure(error);
    return privateJson(failure.body, failure.status);
  }
}
