/**
 * Readiness probe for verify-stacks launch.
 * Signs in as fixture subject alice, checks /api/auth/session, then signs out.
 * Does not call /api/books, so example books stay unseeded until the browser shelf loads.
 */
const base = process.env.AUTH_URL;
if (!base) {
  console.error("fail  AUTH_URL is unset");
  process.exit(1);
}

const { oidcSignIn } = await import("../../../../scripts/test/oidc-flow.mjs");

function remember(jar, response) {
  const cookies = typeof response.headers.getSetCookie === "function" ? response.headers.getSetCookie() : [];
  for (const cookie of cookies) {
    const pair = cookie.split(";")[0] ?? "";
    const eq = pair.indexOf("=");
    if (eq <= 0) continue;
    const name = pair.slice(0, eq).trim();
    const value = pair.slice(eq + 1).trim();
    if (!value || /max-age=0/i.test(cookie)) jar.delete(name);
    else jar.set(name, value);
  }
}

function cookieHeader(jar) {
  return [...jar.entries()].map(([name, value]) => `${name}=${value}`).join("; ");
}

function jarFromHeader(header) {
  const jar = new Map();
  if (!header) return jar;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq <= 0) continue;
    jar.set(part.slice(0, eq).trim(), part.slice(eq + 1).trim());
  }
  return jar;
}

const signed = await oidcSignIn({ base, subject: "alice" });
if (!signed.sessionToken) {
  console.error(`fail  fixture sign-in did not return a session (HTTP ${signed.status})`);
  process.exit(1);
}

const jar = jarFromHeader(signed.cookieHeader);
const sessionResponse = await fetch(`${base}/api/auth/session`, {
  headers: { cookie: cookieHeader(jar) },
});
const session = await sessionResponse.json().catch(() => null);
if (session?.user?.email !== "alice@example.test") {
  console.error(
    `fail  /api/auth/session email was ${session?.user?.email ?? "missing"} (HTTP ${sessionResponse.status})`,
  );
  process.exit(1);
}

const csrfResponse = await fetch(`${base}/api/auth/csrf`, {
  headers: { cookie: cookieHeader(jar) },
});
remember(jar, csrfResponse);
const csrf = await csrfResponse.json().catch(() => ({}));
if (!csrf.csrfToken) {
  console.error("fail  sign-out probe could not read a CSRF token");
  process.exit(1);
}
const signOut = await fetch(`${base}/api/auth/signout`, {
  method: "POST",
  redirect: "manual",
  headers: {
    cookie: cookieHeader(jar),
    origin: new URL(base).origin,
    "content-type": "application/x-www-form-urlencoded",
  },
  body: new URLSearchParams({ csrfToken: csrf.csrfToken, callbackUrl: "/login" }),
});
remember(jar, signOut);
const after = await fetch(`${base}/api/auth/session`, {
  headers: { cookie: cookieHeader(jar) },
});
const afterBody = await after.json().catch(() => null);
if (afterBody?.user?.email) {
  console.error(`fail  probe sign-out left ${afterBody.user.email} signed in`);
  process.exit(1);
}

console.log("ready sign-in alice@example.test then signed out");
