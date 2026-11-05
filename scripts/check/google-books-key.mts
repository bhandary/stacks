/**
 * Stubbed-fetch checks for Google Books key handling in src/lib/lookup.ts.
 *
 * Run: npm run check:lookup
 */
import { register } from "node:module";
import { pathToFileURL } from "node:url";

register(
  `data:text/javascript,${encodeURIComponent(`
    export async function resolve(specifier, context, nextResolve) {
      const last = specifier.split("/").pop() ?? "";
      const isRelative = specifier.startsWith("./") || specifier.startsWith("../");
      if (isRelative && !last.includes(".")) {
        return nextResolve(specifier + ".ts", context);
      }
      return nextResolve(specifier, context);
    }
  `)}`,
  pathToFileURL("./"),
);

const { lookupIsbn } = await import("../../src/lib/lookup.ts");

const ISBN = "9780547928227";
const SECRET = "test/key+secret";
const ENCODED_SECRET = encodeURIComponent(SECRET);

type CaseResult = { name: string; ok: boolean; detail: string };

const originalFetch = globalThis.fetch;
const originalWarn = console.warn;
const originalKey = process.env.GOOGLE_BOOKS_API_KEY;

function olBody() {
  return {
    [`ISBN:${ISBN}`]: {
      title: "The Hobbit",
      authors: [{ name: "J.R.R. Tolkien" }],
    },
  };
}

async function withStub(opts: {
  key: string | undefined;
  googleStatus: number;
  googleJson?: unknown;
}): Promise<{ urls: string[]; warns: string[]; book: Awaited<ReturnType<typeof lookupIsbn>> }> {
  const urls: string[] = [];
  const warns: string[] = [];

  if (opts.key === undefined) delete process.env.GOOGLE_BOOKS_API_KEY;
  else process.env.GOOGLE_BOOKS_API_KEY = opts.key;

  console.warn = (...args: unknown[]) => {
    warns.push(args.map((arg) => String(arg)).join(" "));
  };

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    urls.push(url);
    if (url.includes("googleapis.com")) {
      if (opts.googleStatus >= 200 && opts.googleStatus < 300) {
        return Response.json(opts.googleJson ?? { items: [] }, { status: opts.googleStatus });
      }
      return new Response("RESOURCE_EXHAUSTED", { status: opts.googleStatus });
    }
    if (url.includes("openlibrary.org")) {
      return Response.json(olBody());
    }
    throw new Error(`unexpected fetch ${url}`);
  }) as typeof fetch;

  try {
    const book = await lookupIsbn(ISBN);
    return { urls, warns, book };
  } finally {
    globalThis.fetch = originalFetch;
    console.warn = originalWarn;
  }
}

function googleUrl(urls: string[]): string {
  const url = urls.find((item) => item.includes("googleapis.com"));
  if (!url) throw new Error("Google Books URL was not fetched");
  return url;
}

const cases: CaseResult[] = [];

{
  const { urls, book } = await withStub({ key: undefined, googleStatus: 200 });
  const url = googleUrl(urls);
  const noKey = !/[?&]key=/.test(url);
  cases.push({
    name: "key absent -> URL has no key=",
    ok: noKey,
    detail: url,
  });
  cases.push({
    name: "key absent -> Open Library title still merged",
    ok: book?.title === "The Hobbit",
    detail: book?.title ?? "null",
  });
}

{
  const { urls } = await withStub({ key: SECRET, googleStatus: 200 });
  const url = googleUrl(urls);
  const hasKey = url.includes(`key=${ENCODED_SECRET}`);
  const rawLeak = url.includes(SECRET) && !url.includes(ENCODED_SECRET);
  cases.push({
    name: "key present -> URL has encoded key=",
    ok: hasKey && !rawLeak,
    detail: url.replaceAll(ENCODED_SECRET, "[redacted]"),
  });
}

{
  const { urls, warns, book } = await withStub({ key: SECRET, googleStatus: 429 });
  const url = googleUrl(urls);
  const warnText = warns.join("\n");
  const warned429 =
    warns.length > 0 &&
    warnText.includes("www.googleapis.com") &&
    warnText.includes("429");
  const noKeyInWarn =
    !warnText.includes(SECRET) &&
    !warnText.includes(ENCODED_SECRET) &&
    !warnText.includes(url);
  const usedOpenLibrary =
    book?.title === "The Hobbit" &&
    book.author === "J.R.R. Tolkien" &&
    (book.sources ?? []).includes("Open Library") &&
    !(book.sources ?? []).includes("Google Books");

  cases.push({
    name: "429 -> warn includes host and status",
    ok: warned429,
    detail: warnText || "(no warnings)",
  });
  cases.push({
    name: "429 -> warn does not include key or full URL",
    ok: noKeyInWarn,
    detail: warnText || "(no warnings)",
  });
  cases.push({
    name: "429 -> lookup still returns Open Library data",
    ok: usedOpenLibrary,
    detail: JSON.stringify(book),
  });
}

if (originalKey === undefined) delete process.env.GOOGLE_BOOKS_API_KEY;
else process.env.GOOGLE_BOOKS_API_KEY = originalKey;

let failed = 0;
for (const result of cases) {
  const mark = result.ok ? "PASS" : "FAIL";
  if (!result.ok) failed += 1;
  console.log(`${mark} ${result.name}`);
  if (!result.ok) console.log(`  ${result.detail}`);
}

if (failed) {
  console.log(`FAIL google-books-key (${failed} failed)`);
  process.exit(1);
}

console.log("PASS google-books-key");
