/**
 * Exhaustive-bounded checks of the real ISBN functions in src/lib/isbn.ts.
 *
 * Oracle is the ISO 2108 / GS1 modular checksum, not a copy of the
 * implementation's "compute check digit then compare" form. If you change
 * the oracle, you are changing the spec — that is a modeling edit, not a
 * product-code edit.
 *
 * Run: npm run formal:isbn
 */
import {
  digitsOnly,
  formatIsbn,
  isIsbn10,
  isIsbn13,
  isbn10To13,
  isbn13CheckDigit,
  looksLikeIsbn,
  normalizeIsbn,
} from "../../src/lib/isbn.ts";

const ISBN10_BODY_MAX = 100_000;
const ISBN13_SUFFIX_MAX = 100_000;
const ISBN13_PREFIXES = ["978", "979", "000"] as const;
const RANDOM_BODIES = 20_000;
const RANDOM_SEED = 20261022;

const COVERED_FILE = "src/lib/isbn.ts";
const COVERED_FUNCTIONS = [
  "digitsOnly",
  "isIsbn13",
  "isIsbn10",
  "isbn13CheckDigit",
  "isbn10To13",
  "normalizeIsbn",
  "looksLikeIsbn",
  "formatIsbn",
] as const;

const APP_FIXTURES: Array<{ raw: string; isbn13: string; why: string }> = [
  { raw: "9780141439518", isbn13: "9780141439518", why: "verify-stacks camera ISBN (Pride and Prejudice)" },
  { raw: "0141439513", isbn13: "9780141439518", why: "ISBN-10 of the camera fixture" },
  { raw: "978-0-14-143951-8", isbn13: "9780141439518", why: "hyphenated camera fixture" },
  { raw: "9780451524935", isbn13: "9780451524935", why: "verify-stacks manual lookup (1984)" },
  { raw: "0451524934", isbn13: "9780451524935", why: "ISBN-10 of 1984" },
  { raw: "0-451-52493-4", isbn13: "9780451524935", why: "hyphenated ISBN-10 of 1984" },
  { raw: "9780593135204", isbn13: "9780593135204", why: "example book Project Hail Mary" },
  { raw: "9780062316097", isbn13: "9780062316097", why: "example book Sapiens" },
  { raw: "9780547928227", isbn13: "9780547928227", why: "example book The Hobbit" },
];

type Property = {
  id: string;
  property: string;
  harm: string;
};

const PROPERTIES: Property[] = [
  {
    id: "P-isbn10-check",
    property:
      "isIsbn10(s) is true exactly when s is 9 digits plus a check character and the ISO 2108 weighted sum is 0 mod 11 (X counts as 10).",
    harm: "A mistyped ISBN-10 would be treated as a real edition, or a valid barcode would be rejected at scan/lookup.",
  },
  {
    id: "P-isbn13-check",
    property:
      "isIsbn13(s) is true exactly when s is 13 digits and the GS1 weighted sum (1,3 repeating) is 0 mod 10.",
    harm: "A mistyped ISBN-13 barcode would look up or store the wrong book, or a valid one would be refused.",
  },
  {
    id: "P-isbn13-check-digit-fn",
    property:
      "isbn13CheckDigit(body12) is the unique digit d such that body12+d satisfies the ISBN-13 checksum.",
    harm: "ISBN-10→13 conversion and ISBN-13 validation would disagree, so the same edition would get two different numbers.",
  },
  {
    id: "P-isbn10-to-13",
    property:
      "isbn10To13(isbn10) is 978 plus the first 9 digits of isbn10 plus the ISBN-13 check digit, and that result is a valid ISBN-13.",
    harm: "The same book scanned as ISBN-10 would not match the ISBN-13 printed on the barcode.",
  },
  {
    id: "P-normalize-accept",
    property:
      "normalizeIsbn(input) returns the canonical 13-digit ISBN when digitsOnly(input) is a valid ISBN-10 or ISBN-13, and ISBN-10 maps through isbn10To13.",
    harm: "Lookup, scan, and save would key the same edition differently depending on punctuation or ISBN-10 vs ISBN-13.",
  },
  {
    id: "P-normalize-reject",
    property:
      "normalizeIsbn(input) returns null when digitsOnly(input) is not a check-valid ISBN-10 or ISBN-13.",
    harm: "Lookup would query the catalog with a number that is not an ISBN, or scan would accept a wrong barcode.",
  },
  {
    id: "P-equivalent-forms",
    property:
      "For every valid ISBN-10, normalizeIsbn(isbn10) === normalizeIsbn(isbn10To13(isbn10)), and hyphen/space/case variants of either form normalize to that same ISBN-13.",
    harm: "A reader who types 0-451-52493-4 and one who types 978-0-451-52493-5 would not hit the same catalog record.",
  },
  {
    id: "P-looks-like-length",
    property:
      "looksLikeIsbn(input) is true exactly when digitsOnly(input) has length 10 or 13. It does not check the check digit.",
    harm: "Callers that treat looksLikeIsbn as validity (the scan manual path does, then still calls normalizeIsbn) would mislabel a bad check digit as a valid ISBN.",
  },
  {
    id: "P-format-preserves-digits",
    property:
      "digitsOnly(formatIsbn(s)) equals digitsOnly(s) when s strips to length 10 or 13; otherwise formatIsbn returns s unchanged.",
    harm: "The shelf card would display an ISBN that no longer matches the stored digits.",
  },
];

class Failure extends Error {
  propertyId: string;
  steps: string[];
  detail: string;

  constructor(propertyId: string, steps: string[], detail: string) {
    super(`${propertyId}: ${detail}`);
    this.name = "Failure";
    this.propertyId = propertyId;
    this.steps = steps;
    this.detail = detail;
  }
}

function fail(propertyId: string, steps: string[], detail: string): never {
  throw new Failure(propertyId, steps, detail);
}

function isbn10Spec(value: string): boolean {
  if (!/^\d{9}[\dX]$/.test(value)) return false;
  let sum = 0;
  for (let i = 0; i < 10; i++) {
    const digit = value[i] === "X" ? 10 : Number(value[i]);
    sum += digit * (10 - i);
  }
  return sum % 11 === 0;
}

function isbn13Spec(value: string): boolean {
  if (!/^\d{13}$/.test(value)) return false;
  let sum = 0;
  for (let i = 0; i < 13; i++) {
    sum += Number(value[i]) * (i % 2 === 0 ? 1 : 3);
  }
  return sum % 10 === 0;
}

function specIsbn13CheckDigit(body12: string): string {
  for (const digit of "0123456789") {
    if (isbn13Spec(`${body12}${digit}`)) return digit;
  }
  throw new Error(`no ISBN-13 check digit for ${body12}`);
}

function pad(value: number, width: number): string {
  return String(value).padStart(width, "0");
}

function mulberry32(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), t | 1);
    r ^= r + Math.imul(r ^ (r >>> 7), r | 61);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function punctuationVariants(isbn: string): string[] {
  const variants = new Set<string>([
    isbn,
    isbn.split("").join("-"),
    isbn.split("").join(" "),
    `  ${isbn}  `,
    isbn.replace(/(\d{3})(\d{9})(\d)/, "$1-$2-$3"),
    isbn.replace(/(\d{9})([\dX])/, "$1-$2"),
  ]);
  if (isbn.endsWith("X")) variants.add(isbn.slice(0, 9) + "x");
  return [...variants];
}

const counts = new Map<string, number>(PROPERTIES.map((property) => [property.id, 0]));

function saw(propertyId: string) {
  counts.set(propertyId, (counts.get(propertyId) ?? 0) + 1);
}

function checkIsbn10(isbn10: string) {
  const spec = isbn10Spec(isbn10);
  const got = isIsbn10(isbn10);
  if (got !== spec) {
    fail(
      "P-isbn10-check",
      [
        `isIsbn10("${isbn10}")`,
        `ISO 2108 weighted sum ${spec ? "holds" : "fails"} (X=10, weights 10..1, 0 mod 11)`,
      ],
      `expected ${spec}, got ${got}`,
    );
  }
  saw("P-isbn10-check");

  if (!spec) {
    if (normalizeIsbn(isbn10) !== null) {
      fail(
        "P-normalize-reject",
        [`normalizeIsbn("${isbn10}")`, "digitsOnly left a 10-character string whose ISBN-10 checksum fails"],
        `expected null, got ${JSON.stringify(normalizeIsbn(isbn10))}`,
      );
    }
    saw("P-normalize-reject");
    return;
  }

  const converted = isbn10To13(isbn10);
  const expected13 = `978${isbn10.slice(0, 9)}${specIsbn13CheckDigit(`978${isbn10.slice(0, 9)}`)}`;
  if (converted !== expected13 || !isbn13Spec(converted)) {
    fail(
      "P-isbn10-to-13",
      [
        `isbn10To13("${isbn10}")`,
        `expected 978 + first 9 digits + ISBN-13 check = ${expected13}`,
      ],
      `got ${converted}`,
    );
  }
  saw("P-isbn10-to-13");

  const normalized = normalizeIsbn(isbn10);
  if (normalized !== converted) {
    fail(
      "P-normalize-accept",
      [`normalizeIsbn("${isbn10}")`, `isbn10To13("${isbn10}") is ${converted}`],
      `got ${JSON.stringify(normalized)}`,
    );
  }
  saw("P-normalize-accept");

  const from13 = normalizeIsbn(converted);
  if (from13 !== converted || from13 !== normalized) {
    fail(
      "P-equivalent-forms",
      [
        `normalizeIsbn("${isbn10}") → ${JSON.stringify(normalized)}`,
        `isbn10To13("${isbn10}") → ${converted}`,
        `normalizeIsbn("${converted}") → ${JSON.stringify(from13)}`,
      ],
      "ISBN-10 and its ISBN-13 form must normalize to the same ISBN-13",
    );
  }
  saw("P-equivalent-forms");
}

function checkIsbn13(isbn13: string) {
  const spec = isbn13Spec(isbn13);
  const got = isIsbn13(isbn13);
  if (got !== spec) {
    fail(
      "P-isbn13-check",
      [
        `isIsbn13("${isbn13}")`,
        `GS1 weighted sum ${spec ? "holds" : "fails"} (weights 1,3 repeating, 0 mod 10)`,
      ],
      `expected ${spec}, got ${got}`,
    );
  }
  saw("P-isbn13-check");

  if (!spec) {
    if (isbn13.length === 13 && /^\d{13}$/.test(isbn13) && normalizeIsbn(isbn13) !== null) {
      fail(
        "P-normalize-reject",
        [`normalizeIsbn("${isbn13}")`, "13 digits whose ISBN-13 checksum fails"],
        `expected null, got ${JSON.stringify(normalizeIsbn(isbn13))}`,
      );
    }
    if (/^\d{13}$/.test(isbn13)) saw("P-normalize-reject");
    return;
  }

  const normalized = normalizeIsbn(isbn13);
  if (normalized !== isbn13) {
    fail(
      "P-normalize-accept",
      [`normalizeIsbn("${isbn13}")`, "input is already a valid ISBN-13"],
      `got ${JSON.stringify(normalized)}`,
    );
  }
  saw("P-normalize-accept");
}

function checkCheckDigitFn(body12: string) {
  const got = isbn13CheckDigit(body12);
  const expected = specIsbn13CheckDigit(body12);
  if (got !== expected) {
    fail(
      "P-isbn13-check-digit-fn",
      [
        `isbn13CheckDigit("${body12}")`,
        `unique digit d with ISBN-13 checksum on ${body12}+d is ${expected}`,
      ],
      `got ${got}`,
    );
  }
  if (!isbn13Spec(`${body12}${got}`)) {
    fail(
      "P-isbn13-check-digit-fn",
      [`isbn13CheckDigit("${body12}") → ${got}`, `isIsbn13("${body12}${got}") should hold by construction`],
      "check digit does not produce a valid ISBN-13",
    );
  }
  saw("P-isbn13-check-digit-fn");
}

function checkLooksLike(input: string, stripped: string) {
  const got = looksLikeIsbn(input);
  const expected = stripped.length === 10 || stripped.length === 13;
  if (got !== expected) {
    fail(
      "P-looks-like-length",
      [
        `looksLikeIsbn(${JSON.stringify(input)})`,
        `digitsOnly → ${JSON.stringify(stripped)} (length ${stripped.length})`,
      ],
      `expected ${expected}, got ${got}`,
    );
  }
  saw("P-looks-like-length");
}

function checkFormat(input: string) {
  const stripped = digitsOnly(input);
  const formatted = formatIsbn(input);
  if (stripped.length === 10 || stripped.length === 13) {
    if (digitsOnly(formatted) !== stripped) {
      fail(
        "P-format-preserves-digits",
        [
          `formatIsbn(${JSON.stringify(input)}) → ${JSON.stringify(formatted)}`,
          `digitsOnly of that should stay ${JSON.stringify(stripped)}`,
        ],
        `digitsOnly(formatIsbn(...)) is ${JSON.stringify(digitsOnly(formatted))}`,
      );
    }
  } else if (formatted !== input) {
    fail(
      "P-format-preserves-digits",
      [`formatIsbn(${JSON.stringify(input)})`, "length is not 10 or 13, so the function should return the input unchanged"],
      `got ${JSON.stringify(formatted)}`,
    );
  }
  saw("P-format-preserves-digits");
}

function checkVariants(canonical13: string, source: string) {
  for (const variant of punctuationVariants(source)) {
    const got = normalizeIsbn(variant);
    if (got !== canonical13) {
      fail(
        "P-equivalent-forms",
        [
          `digitsOnly(${JSON.stringify(variant)}) → ${JSON.stringify(digitsOnly(variant))}`,
          `normalizeIsbn(${JSON.stringify(variant)})`,
          `canonical ISBN-13 is ${canonical13}`,
        ],
        `got ${JSON.stringify(got)}`,
      );
    }
    saw("P-equivalent-forms");
    checkLooksLike(variant, digitsOnly(variant));
    checkFormat(variant);
  }
}

function checkRejection(input: string, reason: string) {
  const stripped = digitsOnly(input);
  if (/^\d{13}$/.test(stripped)) checkIsbn13(stripped);
  if (/^\d{9}[\dX]$/.test(stripped)) checkIsbn10(stripped);
  const got = normalizeIsbn(input);
  if (got !== null) {
    fail(
      "P-normalize-reject",
      [`normalizeIsbn(${JSON.stringify(input)})`, `digitsOnly → ${JSON.stringify(stripped)}`, reason],
      `expected null, got ${JSON.stringify(got)}`,
    );
  }
  saw("P-normalize-reject");
  checkLooksLike(input, stripped);
  checkFormat(input);
}

function structuralBodies(width: number): string[] {
  const bodies: string[] = [];
  const zeros = "0".repeat(width);
  const nines = "9".repeat(width);
  for (let position = 0; position < width; position++) {
    for (let digit = 0; digit <= 9; digit++) {
      const asZero = zeros.slice(0, position) + String(digit) + zeros.slice(position + 1);
      const asNine = nines.slice(0, position) + String(digit) + nines.slice(position + 1);
      bodies.push(asZero, asNine);
    }
  }
  for (let digit = 0; digit <= 9; digit++) bodies.push(String(digit).repeat(width));
  return [...new Set(bodies)];
}

function checkIsbn10Body(body: string) {
  const accepted: string[] = [];
  for (const check of "0123456789X") {
    const isbn10 = `${body}${check}`;
    checkIsbn10(isbn10);
    if (isbn10Spec(isbn10)) accepted.push(check);
  }
  if (accepted.length !== 1) {
    fail(
      "P-isbn10-check",
      [`body ${body}`, "try each check character 0-9 and X"],
      `expected exactly one valid check, got [${accepted.join(",")}]`,
    );
  }
  const isbn10 = `${body}${accepted[0]}`;
  const isbn13 = isbn10To13(isbn10);
  checkVariants(isbn13, isbn10);
  checkVariants(isbn13, isbn13);
  if (accepted[0] === "X") {
    const lower = normalizeIsbn(`${body}x`);
    if (lower !== isbn13) {
      fail(
        "P-equivalent-forms",
        [`normalizeIsbn("${body}x")`, `normalizeIsbn("${isbn10}") → ${isbn13}`],
        `lowercase x should match uppercase X, got ${JSON.stringify(lower)}`,
      );
    }
    saw("P-equivalent-forms");
  }
}

function checkIsbn13Body(body12: string) {
  checkCheckDigitFn(body12);
  const accepted: string[] = [];
  for (const check of "0123456789") {
    const isbn13 = `${body12}${check}`;
    checkIsbn13(isbn13);
    if (isbn13Spec(isbn13)) accepted.push(check);
  }
  if (accepted.length !== 1) {
    fail(
      "P-isbn13-check",
      [`body ${body12}`, "try each check digit 0-9"],
      `expected exactly one valid check, got [${accepted.join(",")}]`,
    );
  }
}

function runBound() {
  for (let n = 0; n < ISBN10_BODY_MAX; n++) {
    checkIsbn10Body(pad(n, 9));
  }
  for (const prefix of ISBN13_PREFIXES) {
    for (let n = 0; n < ISBN13_SUFFIX_MAX; n++) {
      checkIsbn13Body(`${prefix}${pad(n, 9)}`);
    }
  }
}

function runStructural() {
  for (const body of structuralBodies(9)) checkIsbn10Body(body);
  for (const prefix of ISBN13_PREFIXES) {
    for (const suffix of structuralBodies(9)) checkIsbn13Body(`${prefix}${suffix}`);
  }
}

function runRandom() {
  const random = mulberry32(RANDOM_SEED);
  for (let i = 0; i < RANDOM_BODIES; i++) {
    const body = pad(Math.floor(random() * 1_000_000_000), 9);
    if (Number(body) < ISBN10_BODY_MAX) continue;
    checkIsbn10Body(body);
    const prefix = ISBN13_PREFIXES[Math.floor(random() * ISBN13_PREFIXES.length)];
    const suffix = pad(Math.floor(random() * 1_000_000_000), 9);
    checkIsbn13Body(`${prefix}${suffix}`);
  }
}

function runFixtures() {
  checkCheckDigitFn("978014143951");
  checkCheckDigitFn("978045152493");
  for (const fixture of APP_FIXTURES) {
    const got = normalizeIsbn(fixture.raw);
    if (got !== fixture.isbn13) {
      fail(
        "P-normalize-accept",
        [
          `normalizeIsbn(${JSON.stringify(fixture.raw)})`,
          fixture.why,
          `stored/looked-up ISBN-13 must be ${fixture.isbn13}`,
        ],
        `got ${JSON.stringify(got)}`,
      );
    }
    saw("P-normalize-accept");
    checkLooksLike(fixture.raw, digitsOnly(fixture.raw));
    checkFormat(fixture.raw);
    if (digitsOnly(fixture.raw).length === 10) {
      checkIsbn10(digitsOnly(fixture.raw));
    }
    checkIsbn13(fixture.isbn13);
  }
}

function runRejects() {
  const rejects: Array<[string, string]> = [
    ["", "empty string"],
    ["978", "too short"],
    ["123456789", "9 digits is not an ISBN-10"],
    ["12345678901", "11 digits"],
    ["123456789012", "12 digits"],
    ["12345678901234", "14 digits"],
    ["9780141439519", "Pride and Prejudice ISBN-13 with last digit incremented"],
    ["0141439514", "Pride and Prejudice ISBN-10 with last digit incremented"],
    ["978014143951X", "ISBN-13 cannot use X as a check character"],
    ["abcdefghij", "letters that are not an ISBN"],
    ["978-0-14-143951-9", "hyphenated ISBN-13 with a bad check digit"],
  ];
  for (const [input, reason] of rejects) checkRejection(input, reason);
}

function printReport(ok: boolean) {
  const node = process.versions.node;
  console.log(ok ? "PASS formal-verify-isbn" : "FAIL formal-verify-isbn");
  console.log(`tool: Node ${node} --experimental-strip-types (imports ${COVERED_FILE} directly)`);
  console.log(
    `bounds: ISBN-10 bodies ${pad(0, 9)}..${pad(ISBN10_BODY_MAX - 1, 9)} exhaustive; ISBN-13 bodies {${ISBN13_PREFIXES.join(",")}}+9-digit suffix 0..${ISBN13_SUFFIX_MAX - 1} exhaustive; ${RANDOM_BODIES} seeded random 9-digit bodies (seed ${RANDOM_SEED}); structural per-position 0-9; app fixtures`,
  );
  console.log(`covered file: ${COVERED_FILE}`);
  console.log(`covered functions: ${COVERED_FUNCTIONS.join(", ")}`);
  console.log("properties:");
  for (const property of PROPERTIES) {
    const n = counts.get(property.id) ?? 0;
    console.log(`  ${property.id}  ${n} checks`);
    console.log(`    property: ${property.property}`);
    console.log(`    harm: ${property.harm}`);
  }
}

function main() {
  try {
    runFixtures();
    runRejects();
    runStructural();
    runBound();
    runRandom();
    printReport(true);
  } catch (error) {
    if (error instanceof Failure) {
      const property = PROPERTIES.find((item) => item.id === error.propertyId);
      console.error(`FAIL ${error.propertyId}`);
      if (property) {
        console.error(`property: ${property.property}`);
        console.error(`harm: ${property.harm}`);
      }
      for (const [index, step] of error.steps.entries()) {
        console.error(`  ${index + 1}. ${step}`);
      }
      console.error(`  → ${error.detail}`);
      printReport(false);
      process.exitCode = 1;
      return;
    }
    throw error;
  }
}

main();
