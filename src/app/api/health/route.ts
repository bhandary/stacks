import { NextResponse } from "next/server";
import { ensureSchema } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await ensureSchema();
    return NextResponse.json({ ok: true, db: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Database unavailable";
    return NextResponse.json({ ok: false, db: false, error: message }, { status: 503 });
  }
}
