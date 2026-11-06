import { NextResponse } from "next/server";
import { backupFailure, createBackup } from "@/lib/backup";
import { AuthError, privateJson } from "@/lib/http";
import { requireUser } from "@/lib/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    const user = await requireUser();
    const backup = await createBackup(user.id);
    const stamp = backup.createdAt.replace(/[:.]/g, "-");
    const filename = `stacks-backup-${stamp}.json`;
    return new NextResponse(JSON.stringify(backup, null, 2), {
      status: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "private, no-store, max-age=0",
        Pragma: "no-cache",
        Vary: "Cookie",
      },
    });
  } catch (error) {
    if (error instanceof AuthError) return privateJson({ error: error.message }, error.status);
    const failure = backupFailure(error);
    return privateJson(failure.body, failure.status);
  }
}
