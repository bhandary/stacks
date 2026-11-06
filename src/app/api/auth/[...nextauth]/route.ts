import type { NextRequest } from "next/server";
import { handlers } from "@/auth";
import { ensureSchema } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  await ensureSchema();
  return handlers.GET(request);
}

export async function POST(request: NextRequest) {
  await ensureSchema();
  return handlers.POST(request);
}
