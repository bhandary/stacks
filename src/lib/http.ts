import { NextResponse } from "next/server";
import { readAuthRuntime } from "./auth-config";

const PRIVATE_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0",
  Pragma: "no-cache",
  Vary: "Cookie",
};

export class AuthError extends Error {
  readonly status: 401 | 403;
  constructor(status: 401 | 403, message: string) {
    super(message);
    this.name = "AuthError";
    this.status = status;
  }
}

export function privateJson(body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, { status, headers: PRIVATE_HEADERS });
}

export function assertSameOrigin(request: Request): void {
  const origin = readAuthRuntime(process.env).origin;
  if (!origin) {
    throw new AuthError(403, "Sign-in is not configured");
  }
  const header = request.headers.get("origin");
  if (!header) {
    throw new AuthError(403, "This action must come from the Stacks site");
  }
  let actual: string;
  try {
    actual = new URL(header).origin;
  } catch {
    throw new AuthError(403, "This action must come from the Stacks site");
  }
  if (actual !== origin) {
    throw new AuthError(403, "This action must come from the Stacks site");
  }
  const site = request.headers.get("sec-fetch-site");
  if (site && site !== "same-origin" && site !== "none") {
    throw new AuthError(403, "This action must come from the Stacks site");
  }
}
