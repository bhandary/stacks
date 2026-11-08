import { createHash, randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { exportJWK, generateKeyPair, SignJWT, calculateJwkThumbprint } from "jose";

export const TEST_CLIENT_ID = "stacks-test-client";
export const TEST_CLIENT_SECRET = "stacks-test-secret";

const SUBJECT_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const FAULTS = new Set(["exp", "aud", "sig", "unverified", "nosub", "iss", "clientsub"]);

function s256(verifier) {
  return createHash("sha256").update(verifier).digest("base64url");
}

function basicAuthorized(header) {
  if (!header?.startsWith("Basic ")) return false;
  const decoded = Buffer.from(header.slice(6), "base64").toString("utf8");
  const split = decoded.indexOf(":");
  if (split < 0) return false;
  return decoded.slice(0, split) === TEST_CLIENT_ID && decoded.slice(split + 1) === TEST_CLIENT_SECRET;
}

function allowedRedirect(value) {
  try {
    const url = new URL(value);
    return (
      url.protocol === "http:" &&
      (url.hostname === "127.0.0.1" || url.hostname === "localhost") &&
      url.pathname === "/api/auth/callback/stacks-test-oidc"
    );
  } catch {
    return false;
  }
}

function send(res, status, body, type = "application/json") {
  res.writeHead(status, {
    "content-type": type,
    "cache-control": "no-store",
  });
  res.end(typeof body === "string" ? body : JSON.stringify(body));
}

export async function startOidcFixture(port = 0) {
  const { publicKey, privateKey } = await generateKeyPair("RS256", { extractable: true });
  const other = await generateKeyPair("RS256", { extractable: true });
  const jwk = await exportJWK(publicKey);
  jwk.alg = "RS256";
  jwk.use = "sig";
  jwk.kid = await calculateJwkThumbprint(jwk);
  const codes = new Map();
  let issuer = "";

  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", issuer);
      if (req.method === "GET" && url.pathname === "/.well-known/openid-configuration") {
        send(res, 200, {
          issuer,
          authorization_endpoint: `${issuer}/authorize`,
          token_endpoint: `${issuer}/token`,
          userinfo_endpoint: `${issuer}/userinfo`,
          jwks_uri: `${issuer}/jwks`,
          response_types_supported: ["code"],
          subject_types_supported: ["public"],
          id_token_signing_alg_values_supported: ["RS256"],
          code_challenge_methods_supported: ["S256"],
          scopes_supported: ["openid", "email", "profile"],
          token_endpoint_auth_methods_supported: ["client_secret_basic"],
          claims_supported: ["sub", "iss", "aud", "exp", "iat", "nonce", "email", "email_verified", "name"],
        });
        return;
      }
      if (req.method === "GET" && url.pathname === "/jwks") {
        send(res, 200, { keys: [jwk] });
        return;
      }
      if (req.method === "GET" && url.pathname === "/authorize") {
        const redirectUri = url.searchParams.get("redirect_uri") ?? "";
        const challenge = url.searchParams.get("code_challenge") ?? "";
        const method = url.searchParams.get("code_challenge_method");
        const state = url.searchParams.get("state") ?? "";
        const nonce = url.searchParams.get("nonce") ?? "";
        const hint = url.searchParams.get("login_hint") ?? "";
        if (
          url.searchParams.get("client_id") !== TEST_CLIENT_ID ||
          url.searchParams.get("response_type") !== "code" ||
          !allowedRedirect(redirectUri) ||
          !challenge ||
          method !== "S256" ||
          !state ||
          !nonce
        ) {
          send(res, 400, { error: "invalid_request" });
          return;
        }
        if (!hint) {
          const hidden = ["client_id", "redirect_uri", "response_type", "scope", "state", "nonce", "code_challenge", "code_challenge_method"]
            .map((key) => {
              const value = url.searchParams.get(key) ?? "";
              return `<input type="hidden" name="${key}" value="${value.replace(/"/g, "&quot;")}" />`;
            })
            .join("");
          send(
            res,
            200,
            `<!doctype html><title>Test OIDC</title><form method="get" action="/authorize">${hidden}<button name="login_hint" value="alice">Alice</button><button name="login_hint" value="bob">Bob</button></form>`,
            "text/html; charset=utf-8",
          );
          return;
        }
        if (!SUBJECT_RE.test(hint)) {
          send(res, 400, { error: "invalid_request" });
          return;
        }
        const fault = url.searchParams.get("fault") ?? "";
        if (fault && !FAULTS.has(fault)) {
          send(res, 400, { error: "invalid_request" });
          return;
        }
        const code = randomBytes(24).toString("base64url");
        codes.set(code, {
          challenge,
          redirectUri,
          nonce,
          subject: hint,
          fault,
          email: url.searchParams.get("email") ?? "",
          exp: Date.now() + 5 * 60 * 1000,
        });
        const back = new URL(redirectUri);
        back.searchParams.set("code", code);
        back.searchParams.set("state", state);
        res.writeHead(302, { location: back.toString(), "cache-control": "no-store" });
        res.end();
        return;
      }
      if (req.method === "POST" && url.pathname === "/token") {
        if (!basicAuthorized(req.headers.authorization)) {
          send(res, 401, { error: "invalid_client" });
          return;
        }
        const chunks = [];
        for await (const chunk of req) chunks.push(chunk);
        const body = new URLSearchParams(Buffer.concat(chunks).toString("utf8"));
        const code = body.get("code") ?? "";
        const saved = codes.get(code);
        codes.delete(code);
        if (
          body.get("grant_type") !== "authorization_code" ||
          !saved ||
          saved.exp < Date.now() ||
          body.get("redirect_uri") !== saved.redirectUri ||
          s256(body.get("code_verifier") ?? "") !== saved.challenge
        ) {
          send(res, 400, { error: "invalid_grant" });
          return;
        }
        const now = Math.floor(Date.now() / 1000);
        const subject = saved.fault === "clientsub" ? TEST_CLIENT_ID : saved.subject;
        const claims = {
          iss: saved.fault === "iss" ? "https://accounts.google.com" : issuer,
          aud: saved.fault === "aud" ? "wrong-client" : TEST_CLIENT_ID,
          iat: saved.fault === "exp" ? now - 1200 : now,
          exp: saved.fault === "exp" ? now - 600 : now + 300,
          nonce: saved.nonce,
          email: /^[^@\s]+@[^@\s]+$/.test(saved.email) ? saved.email : `${saved.subject}@example.test`,
          email_verified: saved.fault === "unverified" ? false : true,
          name: `Test ${saved.subject}`,
        };
        if (saved.fault !== "nosub") claims.sub = subject;
        const token = await new SignJWT(claims)
          .setProtectedHeader({ alg: "RS256", kid: jwk.kid })
          .sign(saved.fault === "sig" ? other.privateKey : privateKey);
        send(res, 200, {
          access_token: `fixture-access-${code.slice(0, 8)}`,
          token_type: "Bearer",
          expires_in: 300,
          id_token: token,
          scope: "openid email profile",
        });
        return;
      }
      if (req.method === "GET" && url.pathname === "/userinfo") {
        send(res, 200, { sub: "unused" });
        return;
      }
      send(res, 404, { error: "not_found" });
    } catch {
      send(res, 500, { error: "fixture_error" });
    }
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });
  const address = server.address();
  const bound = typeof address === "object" && address ? address.port : port;
  issuer = `http://127.0.0.1:${bound}`;
  return {
    issuer,
    port: bound,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

const calledDirectly = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (calledDirectly) {
  const raw = process.argv[2] || process.env.STACKS_AUTH_TEST_ISSUER;
  if (!raw) {
    console.error("Pass an issuer URL, for example http://127.0.0.1:43179");
    process.exit(1);
  }
  const desired = new URL(raw);
  const fixture = await startOidcFixture(Number(desired.port));
  console.log(`oidc fixture ${fixture.issuer}`);
}
