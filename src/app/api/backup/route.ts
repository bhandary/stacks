import { NextResponse } from "next/server";
import { backupFailure, createBackup } from "@/lib/backup";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    const backup = await createBackup();
    const stamp = backup.createdAt.replace(/[:.]/g, "-");
    const filename = `stacks-backup-${stamp}.json`;
    return new NextResponse(JSON.stringify(backup, null, 2), {
      status: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    const failure = backupFailure(error);
    return NextResponse.json(failure.body, { status: failure.status });
  }
}
