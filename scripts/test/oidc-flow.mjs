function originOf(url) {
  return new URL(url).origin;
}

function remember(jar, url, response) {
  const origin = originOf(url);
  const bucket = jar.get(origin) ?? new Map();
  jar.set(origin, bucket);
  const cookies = typeof response.headers.getSetCookie === "function" ? response.headers.getSetCookie() : [];
  for (const cookie of cookies) {
    const pair = cookie.split(";")[0] ?? "";
    const eq = pair.indexOf("=");
    if (eq <= 0) continue;
    const name = pair.slice(0, eq).trim();
    const value = pair.slice(eq + 1).trim();
    if (!value || /max-age=0/i.test(cookie)) bucket.delete(name);
    else bucket.set(name, value);
  }
}

function cookieHeader(jar, url) {
  const bucket = jar.get(originOf(url));
  if (!bucket || bucket.size === 0) return "";
  return [...bucket.entries()].map(([name, value]) => `${name}=${value}`).join("; ");
}

async function send(jar, url, options = {}) {
  const headers = new Headers(options.headers);
  const cookie = cookieHeader(jar, url);
  if (cookie) headers.set("cookie", cookie);
  if (options.origin) headers.set("origin", options.origin);
  const response = await fetch(url, {
    method: options.method,
    headers,
    body: options.body,
    redirect: "manual",
  });
  remember(jar, url, response);
  return response;
}

export async function oidcSignIn({ base, subject, fault, email, callbackUrl = "/" }) {
  const jar = new Map();
  const csrfResponse = await send(jar, `${base}/api/auth/csrf`);
  const csrf = await csrfResponse.json();
  if (!csrf.csrfToken) {
    throw new Error(`OIDC fixture sign-in could not read a CSRF token (${csrfResponse.status})`);
  }
  const params = new URLSearchParams({ login_hint: subject });
  if (fault) params.set("fault", fault);
  if (email) params.set("email", email);
  let current = `${base}/api/auth/signin/stacks-test-oidc?${params}`;
  let response = await send(jar, current, {
    method: "POST",
    origin: originOf(base),
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ csrfToken: csrf.csrfToken, callbackUrl }),
  });
  const hops = [];
  for (let hop = 0; hop < 12; hop += 1) {
    const location = response.headers.get("location");
    if (!location || response.status < 300 || response.status >= 400) break;
    current = new URL(location, current).toString();
    hops.push(current);
    response = await send(jar, current);
  }
  const cookies = jar.get(originOf(base)) ?? new Map();
  const sessionName = [...cookies.keys()].find((name) => name.includes("session-token")) ?? "";
  return {
    hops,
    status: response.status,
    cookieHeader: cookieHeader(jar, base),
    sessionName,
    sessionToken: sessionName ? decodeURIComponent(cookies.get(sessionName)) : "",
  };
}
