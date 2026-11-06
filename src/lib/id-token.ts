import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";

const keys = new Map<string, JWTVerifyGetKey>();

async function verificationKey(issuer: string): Promise<JWTVerifyGetKey> {
  const cached = keys.get(issuer);
  if (cached) return cached;
  const discoveryUrl = new URL("/.well-known/openid-configuration", issuer.endsWith("/") ? issuer : `${issuer}/`);
  const response = await fetch(discoveryUrl, { cache: "no-store" });
  if (!response.ok) {
    throw new Error("ID token rejected");
  }
  const document = (await response.json()) as { jwks_uri?: unknown; issuer?: unknown };
  if (document.issuer !== issuer || typeof document.jwks_uri !== "string") {
    throw new Error("ID token rejected");
  }
  const key = createRemoteJWKSet(new URL(document.jwks_uri));
  keys.set(issuer, key);
  return key;
}

/**
 * Auth.js validates issuer, audience, expiry, and nonce through oauth4webapi.
 * That library's current release stores the ID token and expects the caller to
 * verify the signature separately, and Auth.js does not. This checks the
 * signature, issuer, audience, and expiry with jose before the token is accepted.
 */
export async function assertIdTokenSignature(
  response: Response,
  issuer: string,
  audience: string,
): Promise<void> {
  let idToken = "";
  try {
    const body = (await response.json()) as { id_token?: unknown };
    if (typeof body.id_token === "string") idToken = body.id_token;
  } catch {
    throw new Error("ID token rejected");
  }
  if (!idToken) throw new Error("ID token rejected");
  try {
    await jwtVerify(idToken, await verificationKey(issuer), { issuer, audience });
  } catch {
    throw new Error("ID token rejected");
  }
}
