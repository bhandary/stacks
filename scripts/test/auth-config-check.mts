import assert from "node:assert/strict";
import {
  acceptVerifiedIdentity,
  isTestOidcAllowed,
  readAuthRuntime,
  safeCallbackUrl,
} from "../../src/lib/auth-config.ts";

const base = {
  NODE_ENV: "development",
  STACKS_AUTH_TEST_OIDC: "1",
  STACKS_AUTH_TEST_ISSUER: "http://127.0.0.1:43191",
  AUTH_SECRET: "x".repeat(32),
  AUTH_URL: "http://127.0.0.1:43183",
};

assert.equal(isTestOidcAllowed(base), true);
assert.equal(isTestOidcAllowed({ ...base, NODE_ENV: "production" }), false);
assert.equal(isTestOidcAllowed({ ...base, RAILWAY_ENVIRONMENT: "production" }), false);
assert.equal(isTestOidcAllowed({ ...base, RAILWAY_PROJECT_ID: "proj" }), false);
assert.equal(isTestOidcAllowed({ ...base, VERCEL: "1" }), false);
assert.equal(isTestOidcAllowed({ ...base, STACKS_AUTH_TEST_OIDC: "0" }), false);
assert.equal(isTestOidcAllowed({ ...base, STACKS_AUTH_TEST_ISSUER: "https://accounts.google.com" }), false);
assert.equal(isTestOidcAllowed({ ...base, STACKS_AUTH_TEST_ISSUER: "http://evil.example/oidc" }), false);
assert.equal(
  isTestOidcAllowed({ ...base, AUTH_URL: "https://stacks-production-8e25.up.railway.app" }),
  false,
);
assert.equal(isTestOidcAllowed({ ...base, AUTH_SECRET: "short" }), false);
assert.equal(isTestOidcAllowed({ ...base, AUTH_URL: "" }), false);

const production = readAuthRuntime({
  NODE_ENV: "production",
  AUTH_URL: "https://stacks-production-8e25.up.railway.app",
  AUTH_SECRET: "y".repeat(48),
  AUTH_GOOGLE_ID: "google-client",
  AUTH_GOOGLE_SECRET: "google-secret",
  STACKS_AUTH_TEST_OIDC: "1",
  STACKS_AUTH_TEST_ISSUER: "http://127.0.0.1:9",
});
assert.equal(production.googleEnabled, true);
assert.equal(production.testOidc, false);
assert.equal(production.secureCookies, true);
assert.equal(production.testIssuer, null);

const local = readAuthRuntime(base);
assert.equal(local.googleEnabled, false);
assert.equal(local.testOidc, true);
assert.equal(local.secureCookies, false);
assert.equal(local.configurationError, null);

const closed = readAuthRuntime({ NODE_ENV: "production" });
assert.equal(closed.googleEnabled, false);
assert.equal(closed.testOidc, false);
assert.ok(closed.configurationError);

const origin = "http://127.0.0.1:43183";
assert.equal(safeCallbackUrl("/shelf", origin), `${origin}/shelf`);
assert.equal(safeCallbackUrl(`${origin}/login`, origin), `${origin}/login`);
assert.equal(safeCallbackUrl("https://evil.example/phish", origin), origin);
assert.equal(safeCallbackUrl("//evil.example", origin), origin);
assert.equal(safeCallbackUrl("/\\evil.example", origin), origin);

assert.equal(
  acceptVerifiedIdentity({
    provider: "google",
    providerAccountId: "sub-1",
    profile: { sub: "sub-1", email_verified: true, email: "a@gmail.com" },
    allowedProviders: ["google"],
    clientIds: ["google-client"],
  }),
  true,
);
assert.equal(
  acceptVerifiedIdentity({
    provider: "google",
    providerAccountId: "sub-1",
    profile: { sub: "sub-1", email_verified: false },
    allowedProviders: ["google"],
    clientIds: ["google-client"],
  }),
  false,
);
assert.equal(
  acceptVerifiedIdentity({
    provider: "google",
    providerAccountId: "google-client",
    profile: { sub: "google-client", email_verified: true },
    allowedProviders: ["google"],
    clientIds: ["google-client"],
  }),
  false,
);
assert.equal(
  acceptVerifiedIdentity({
    provider: "google",
    providerAccountId: "other",
    profile: { sub: "sub-1", email_verified: true },
    allowedProviders: ["google"],
    clientIds: [],
  }),
  false,
);
assert.equal(
  acceptVerifiedIdentity({
    provider: "stacks-test-oidc",
    providerAccountId: "alice",
    profile: { sub: "alice", email_verified: "true" },
    allowedProviders: ["stacks-test-oidc"],
    clientIds: [],
  }),
  false,
);

console.log("PASS auth-config");
