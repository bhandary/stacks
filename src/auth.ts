import { randomBytes } from "node:crypto";
import type { Adapter, AdapterAccount, AdapterSession, AdapterUser } from "@auth/core/adapters";
import PostgresAdapter from "@auth/pg-adapter";
import NextAuth, { type Session } from "next-auth";
import Google from "next-auth/providers/google";
import type { Provider } from "next-auth/providers";
import { ensureSchema, getPool } from "@/lib/db";
import { hashSessionToken } from "@/lib/session-token";
import {
  TEST_OIDC_CLIENT_ID,
  TEST_OIDC_CLIENT_SECRET,
  TEST_OIDC_PROVIDER_ID,
  acceptVerifiedIdentity,
  readAuthRuntime,
  safeCallbackUrl,
} from "@/lib/auth-config";
import { assertIdTokenSignature } from "@/lib/id-token";

const GOOGLE_ISSUER = "https://accounts.google.com";

delete process.env.AUTH_REDIRECT_PROXY_URL;

const runtime = readAuthRuntime(process.env);

function identityProfile(profile: Record<string, unknown>, clientId: string) {
  const sub = typeof profile.sub === "string" ? profile.sub.trim() : "";
  if (!sub || sub === clientId) {
    throw new Error("Refusing an identity token without a provider subject");
  }
  return {
    id: sub,
    name: typeof profile.name === "string" ? profile.name : null,
    email: typeof profile.email === "string" ? profile.email : null,
    image: typeof profile.picture === "string" ? profile.picture : null,
  };
}

function googleProvider(): Provider | null {
  if (!runtime.googleEnabled || !runtime.googleClientId) return null;
  const clientId = runtime.googleClientId;
  const clientSecret = process.env.AUTH_GOOGLE_SECRET?.trim() ?? "";
  return Google({
    clientId,
    clientSecret,
    allowDangerousEmailAccountLinking: false,
    checks: ["pkce", "state", "nonce"],
    authorization: {
      params: {
        scope: "openid email profile",
        prompt: "select_account",
        access_type: "online",
        response_type: "code",
        include_granted_scopes: "false",
      },
    },
    token: {
      async conform(response: Response) {
        await assertIdTokenSignature(response, GOOGLE_ISSUER, clientId);
      },
    },
    profile(profile) {
      return identityProfile(profile, clientId);
    },
  });
}

function testOidcProvider(): Provider | null {
  if (!runtime.testOidc || !runtime.testIssuer) return null;
  return {
    id: TEST_OIDC_PROVIDER_ID,
    name: "Stacks test OIDC",
    type: "oidc",
    issuer: runtime.testIssuer,
    clientId: TEST_OIDC_CLIENT_ID,
    clientSecret: TEST_OIDC_CLIENT_SECRET,
    allowDangerousEmailAccountLinking: false,
    checks: ["pkce", "state", "nonce"],
    authorization: {
      params: {
        scope: "openid email profile",
      },
    },
    token: {
      async conform(response: Response) {
        await assertIdTokenSignature(response, runtime.testIssuer ?? "", TEST_OIDC_CLIENT_ID);
      },
    },
    profile(profile) {
      return identityProfile(profile, TEST_OIDC_CLIENT_ID);
    },
  };
}

function clearedAccount(account: AdapterAccount): AdapterAccount {
  return {
    userId: account.userId,
    type: account.type,
    provider: account.provider,
    providerAccountId: account.providerAccountId,
    access_token: null,
    refresh_token: null,
    id_token: null,
    expires_at: null,
    token_type: null,
    scope: null,
    session_state: null,
  } as unknown as AdapterAccount;
}

function tokenFreeAdapter(): Adapter {
  const adapter = PostgresAdapter(getPool());
  return {
    ...adapter,
    async createUser(user: AdapterUser) {
      return adapter.createUser!({
        ...user,
        emailVerified: user.emailVerified ?? new Date(),
      });
    },
    async linkAccount(account: AdapterAccount) {
      await adapter.linkAccount!(clearedAccount(account));
    },
    async createSession(session: AdapterSession) {
      const stored = await adapter.createSession!({
        ...session,
        sessionToken: hashSessionToken(session.sessionToken),
      });
      return { ...stored, sessionToken: session.sessionToken };
    },
    async getSessionAndUser(sessionToken: string) {
      const found = await adapter.getSessionAndUser!(hashSessionToken(sessionToken));
      if (!found) return null;
      return {
        user: found.user,
        session: { ...found.session, sessionToken },
      };
    },
    async updateSession(session: Partial<AdapterSession> & Pick<AdapterSession, "sessionToken">) {
      return adapter.updateSession!({
        ...session,
        sessionToken: hashSessionToken(session.sessionToken),
      });
    },
    async deleteSession(sessionToken: string) {
      await adapter.deleteSession!(hashSessionToken(sessionToken));
    },
  };
}

const providers = [googleProvider(), testOidcProvider()].filter(
  (provider): provider is Provider & { id: string } =>
    Boolean(provider && typeof provider === "object" && "id" in provider),
);
const allowedProviders = providers.map((provider) => provider.id);
const clientIds = [runtime.googleClientId, runtime.testOidc ? TEST_OIDC_CLIENT_ID : null].filter(
  (id): id is string => Boolean(id),
);

const nextAuth = NextAuth({
  adapter: tokenFreeAdapter(),
  providers,
  secret: runtime.secretOk ? process.env.AUTH_SECRET : randomBytes(32).toString("hex"),
  trustHost: Boolean(runtime.origin),
  useSecureCookies: runtime.secureCookies,
  session: {
    strategy: "database",
    maxAge: 60 * 60 * 24 * 14,
    updateAge: 60 * 60 * 24,
  },
  pages: {
    signIn: "/login",
    error: "/login",
  },
  cookies: {
    sessionToken: {
      options: {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        secure: runtime.secureCookies,
      },
    },
    callbackUrl: {
      options: {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        secure: runtime.secureCookies,
      },
    },
    csrfToken: {
      options: {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        secure: runtime.secureCookies,
      },
    },
    pkceCodeVerifier: {
      options: {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        secure: runtime.secureCookies,
      },
    },
    state: {
      options: {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        secure: runtime.secureCookies,
      },
    },
    nonce: {
      options: {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        secure: runtime.secureCookies,
      },
    },
  },
  callbacks: {
    async signIn({ account, profile }) {
      return acceptVerifiedIdentity({
        provider: account?.provider,
        providerAccountId: account?.providerAccountId,
        profile,
        allowedProviders,
        clientIds,
      });
    },
    async redirect({ url, baseUrl }) {
      return safeCallbackUrl(url, baseUrl);
    },
    async session({ session, user }) {
      const expires = session.expires as unknown;
      return {
        expires: expires instanceof Date ? expires.toISOString() : String(expires),
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          image: user.image,
        },
      };
    },
  },
  logger: {
    error(error) {
      const name = error instanceof Error ? error.name : "AuthError";
      console.error(`[auth] ${name}`);
    },
    warn(code) {
      console.warn(`[auth] ${code}`);
    },
    debug() {},
  },
});

export const { handlers, signIn, signOut } = nextAuth;

export async function auth(): Promise<Session | null> {
  await ensureSchema();
  return nextAuth.auth();
}

export function authRuntime() {
  return runtime;
}
