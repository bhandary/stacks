import { NextResponse } from "next/server";
import {
  BackupRejected,
  backupFailure,
  readJsonLimited,
  restoreBackup,
} from "@/lib/backup";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RestoreRequest = {
  confirm?: unknown;
  replace?: unknown;
  backup?: unknown;
};

export async function POST(request: Request) {
  try {
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

    const restored = await restoreBackup(body.backup, { replace: body.replace === true });
    return NextResponse.json({ success: true, restored });
  } catch (error) {
    const failure = backupFailure(error);
    return NextResponse.json(failure.body, { status: failure.status });
  }
}
