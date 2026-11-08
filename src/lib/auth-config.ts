const PRODUCTION_HOST = "stacks-production-8e25.up.railway.app";
const SECRET_MIN = 32;

export const TEST_OIDC_PROVIDER_ID = "stacks-test-oidc";
export const TEST_OIDC_CLIENT_ID = "stacks-test-client";
export const TEST_OIDC_CLIENT_SECRET = "stacks-test-secret";

export type AuthRuntime = {
  secretOk: boolean;
  authUrl: string | null;
  origin: string | null;
  secureCookies: boolean;
  googleEnabled: boolean;
  testOidc: boolean;
  testIssuer: string | null;
  googleClientId: string | null;
  configurationError: string | null;
};

function clean(value: string | undefined): string {
  return value?.trim() ?? "";
}

export function isTestOidcAllowed(env: NodeJS.ProcessEnv): boolean {
  if (env.NODE_ENV === "production") return false;
  if (
    env.RAILWAY_ENVIRONMENT ||
    env.RAILWAY_PROJECT_ID ||
    env.RAILWAY_PUBLIC_DOMAIN ||
    env.RAILWAY_STATIC_URL ||
    env.VERCEL ||
    env.VERCEL_ENV
  ) {
    return false;
  }
  if (env.STACKS_AUTH_TEST_OIDC !== "1") return false;
  if (clean(env.AUTH_SECRET).length < SECRET_MIN && clean(env.NEXTAUTH_SECRET).length < SECRET_MIN) {
    return false;
  }
  const authUrl = clean(env.AUTH_URL || env.NEXTAUTH_URL);
  if (!authUrl) return false;
  if (
    authUrl.includes(PRODUCTION_HOST) ||
    authUrl.includes("railway.app") ||
    authUrl.includes("rlwy.net")
  ) {
    return false;
  }
  try {
    const issuer = new URL(clean(env.STACKS_AUTH_TEST_ISSUER));
    const canonical = new URL(authUrl);
    if (issuer.protocol !== "http:") return false;
    if (issuer.hostname !== "127.0.0.1" && issuer.hostname !== "localhost") return false;
    if (issuer.username || issuer.password || issuer.search || issuer.hash) return false;
    if (canonical.protocol !== "http:" && canonical.protocol !== "https:") return false;
    return true;
  } catch {
    return false;
  }
}

export function readAuthRuntime(env: NodeJS.ProcessEnv): AuthRuntime {
  const secret = clean(env.AUTH_SECRET || env.NEXTAUTH_SECRET);
  const secretOk = secret.length >= SECRET_MIN;
  let origin: string | null = null;
  let authUrl: string | null = null;
  const rawUrl = clean(env.AUTH_URL || env.NEXTAUTH_URL);
  if (rawUrl) {
    try {
      const url = new URL(rawUrl);
      if (url.protocol === "http:" || url.protocol === "https:") {
        origin = url.origin;
        authUrl = url.origin;
      }
    } catch {
      origin = null;
    }
  }
  const googleClientId = clean(env.AUTH_GOOGLE_ID) || null;
  const googleClientSecret = clean(env.AUTH_GOOGLE_SECRET) || null;
  const testOidc = isTestOidcAllowed(env);
  const googleEnabled = Boolean(googleClientId && googleClientSecret && secretOk && origin);
  let configurationError: string | null = null;
  if (!secretOk) {
    configurationError = "AUTH_SECRET must be set to at least 32 characters.";
  } else if (!origin) {
    configurationError = "AUTH_URL must be the canonical http(s) origin of this Stacks site.";
  } else if (!googleEnabled && !testOidc) {
    configurationError = "Google sign-in is not configured.";
  }
  return {
    secretOk,
    authUrl,
    origin,
    secureCookies: origin?.startsWith("https:") ?? false,
    googleEnabled,
    testOidc,
    testIssuer: testOidc ? new URL(clean(env.STACKS_AUTH_TEST_ISSUER)).origin : null,
    googleClientId: googleEnabled ? googleClientId : null,
    configurationError: googleEnabled || testOidc ? null : configurationError,
  };
}

export function acceptVerifiedIdentity(input: {
  provider: string | null | undefined;
  providerAccountId: string | null | undefined;
  profile: unknown;
  allowedProviders: readonly string[];
  clientIds: readonly string[];
}): boolean {
  const provider = input.provider ?? "";
  if (!input.allowedProviders.includes(provider)) return false;
  if (!input.profile || typeof input.profile !== "object") return false;
  const profile = input.profile as Record<string, unknown>;
  if (profile.email_verified !== true) return false;
  const sub = typeof profile.sub === "string" ? profile.sub.trim() : "";
  const accountId = input.providerAccountId?.trim() ?? "";
  if (!sub || !accountId || sub !== accountId) return false;
  if (input.clientIds.some((clientId) => clientId && clientId === sub)) return false;
  return true;
}

export function safeCallbackUrl(url: string, baseUrl: string): string {
  if (!url || url.includes("\\") || url.includes("\0") || url.startsWith("//")) return baseUrl;
  try {
    if (url.startsWith("/")) {
      const target = new URL(url, baseUrl);
      return target.origin === baseUrl ? target.toString() : baseUrl;
    }
    const target = new URL(url);
    return target.origin === baseUrl ? target.toString() : baseUrl;
  } catch {
    return baseUrl;
  }
}
