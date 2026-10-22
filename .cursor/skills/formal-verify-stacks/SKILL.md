---
name: formal-verify-stacks
description: Formally check Stacks ISBN-10/ISBN-13 check digits and ISBN-10→13 conversion against the real TypeScript in src/lib/isbn.ts. Use when changing ISBN normalization, lookup, scan, or anything that stores an ISBN.
---

# Formal verify Stacks ISBNs

Use this when a change can break how a typed, scanned, or imported ISBN becomes the 13-digit number the shelf looks up and stores.

## Why this target

The code's strongest promise that everyday tests miss is: **a string is an ISBN only if its check digit is right, and a valid ISBN-10 becomes the 978-prefixed ISBN-13 of the same edition.**

`lookupIsbn` (`src/lib/lookup.ts`) returns null unless `normalizeIsbn` accepts the input. `GET /api/lookup` (`src/app/api/lookup/route.ts`) rejects unless `looksLikeIsbn` and `normalizeIsbn` both pass. Camera and manual scan (`src/components/scan-isbn.tsx` `accept`, form submit) only keep a `normalizeIsbn` hit. `normalizeBookInput` (`src/lib/books.ts`) stores that canonical ISBN-13 when the input is valid.

The Playwright drive in `.cursor/skills/verify-stacks` uses two published numbers (`9780451524935`, `9780141439518`). It never tries a wrong check digit, an ISBN-10/`X` check, a 979-prefix ISBN-13, or a hyphenated ISBN-10. A one-character check-digit bug would still import those two books.

Catalog merge (Google Books preferred over Open Library in `lookupIsbn`) is a first-nonempty pick, not a checksum. Status/rating bounds are a small enum plus `1..5`. The `books` table has **no unique ISBN**, so the code does not promise dedupe; TLA+ on add/import order would be checking a property the product does not claim. Those are weaker or unclaimed.

## Does this change touch verified code?

The check **runs** `src/lib/isbn.ts` only. Rerun it if the diff includes any of:

| Path | Functions / sites | Why |
| --- | --- | --- |
| `src/lib/isbn.ts` | `digitsOnly`, `isIsbn10`, `isIsbn13`, `isbn13CheckDigit`, `isbn10To13`, `normalizeIsbn`, `looksLikeIsbn`, `formatIsbn` | Implementation under test |
| `src/lib/lookup.ts` | `lookupIsbn` | Calls `normalizeIsbn`; invalid ISBN never hits the network |
| `src/app/api/lookup/route.ts` | `GET` | `looksLikeIsbn` then `normalizeIsbn` |
| `src/components/scan-isbn.tsx` | `accept`, manual submit | Scan keeps only `normalizeIsbn` |
| `src/lib/books.ts` | `normalizeBookInput` | Valid ISBN is stored as `normalizeIsbn` output |

If none of those paths change, this skill does not apply. UI copy, cover art, and Postgres wiring do not affect these properties.

## Tool and why

There is **no project-installable TypeScript program verifier** (no Dafny/CBMC/Liquid binding for this file). The question is an input-domain checksum, not event order, so TLA+ would be a hand model of `normalizeIsbn` — the wrong tool.

The check imports the **real** functions from `src/lib/isbn.ts` with Node's type stripper (Node 22+, already how this repo runs). No extra package. Oracle is the ISO 2108 / GS1 **weighted-sum ≡ 0** rule, written in `scripts/formal/isbn-verify.mts` as `isbn10Spec` / `isbn13Spec`, not a copy of the implementation's "compute expected check, then compare" loop.

Pinned runner: **Node 22** (`--experimental-strip-types`). Last run on Node v22.23.4. Node 20 and earlier cannot import the `.ts` file this way; do not rewrite the functions in the harness to dodge that.

## One command

```bash
npm run formal:isbn
```

That is:

```bash
node --experimental-strip-types --disable-warning=ExperimentalWarning --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/formal/isbn-verify.mts
```

Pass prints `PASS formal-verify-isbn`, each property id with how many times it was checked, the bound, and the covered file/functions. Fail prints `FAIL <property-id>`, one sentence for the property, one for the harm, then short steps that name the real functions and the input, then `expected` / `got`. Exit code 1.

Cheap: about a million ISBN-10 check-character trials and three million ISBN-13 trials. Should finish in a few seconds on a laptop.

## Properties (readable without the tool)

Each id is a function name in `scripts/formal/isbn-verify.mts` (`PROPERTIES`).

| Id | Property | Harm if false |
| --- | --- | --- |
| `P-isbn10-check` | `isIsbn10(s)` is true exactly when `s` is 9 digits plus a check character and the ISO 2108 weighted sum is 0 mod 11 (`X` = 10). | A mistyped ISBN-10 is treated as a real edition, or a valid barcode is rejected. |
| `P-isbn13-check` | `isIsbn13(s)` is true exactly when `s` is 13 digits and the GS1 1,3-repeating sum is 0 mod 10. | A mistyped ISBN-13 is looked up or stored, or a valid one is refused. |
| `P-isbn13-check-digit-fn` | `isbn13CheckDigit(body12)` is the unique digit `d` such that `body12+d` is an ISBN-13. | Conversion and validation disagree, so one edition gets two numbers. |
| `P-isbn10-to-13` | `isbn10To13(isbn10)` is `978` + first 9 digits + that check digit, and the result is a valid ISBN-13. | ISBN-10 scan does not match the ISBN-13 on the barcode. |
| `P-normalize-accept` | `normalizeIsbn(input)` returns that canonical ISBN-13 when `digitsOnly(input)` is a valid ISBN-10 or ISBN-13 (ISBN-10 goes through `isbn10To13`). | Lookup, scan, and save key the same edition differently. |
| `P-normalize-reject` | `normalizeIsbn(input)` is `null` when the stripped value is not a check-valid ISBN-10 or ISBN-13. | Lookup queries garbage, or scan accepts a wrong barcode. |
| `P-equivalent-forms` | For every valid ISBN-10, `normalizeIsbn(isbn10) === normalizeIsbn(isbn10To13(isbn10))`, and hyphen/space/`x` vs `X` variants match. | `0-451-52493-4` and `978-0-451-52493-5` miss each other. |
| `P-looks-like-length` | `looksLikeIsbn(input)` is true iff `digitsOnly(input)` has length 10 or 13. It does **not** check the check digit. | Callers that treat `looksLikeIsbn` as validity mislabel a bad check digit. The scan manual path still calls `normalizeIsbn` afterward. |
| `P-format-preserves-digits` | `digitsOnly(formatIsbn(s))` equals `digitsOnly(s)` when the stripped length is 10 or 13; otherwise `formatIsbn` returns `s`. | The shelf card (`src/components/book-card.tsx`) would show digits that do not match storage. |

## Bounds (honest)

Exhaustive inside the harness constants (`ISBN10_BODY_MAX`, `ISBN13_SUFFIX_MAX`, `ISBN13_PREFIXES`, `RANDOM_BODIES`, `RANDOM_SEED` in `scripts/formal/isbn-verify.mts`):

- Every ISBN-10 body `000000000`–`000099999`, each of 11 check characters `0-9X`
- Every ISBN-13 body `{978,979,000}` + 9-digit suffix `000000000`–`000099999`, each of 10 check digits
- Structural bodies: each position 0–9 with the rest 0 and the rest 9; all-same digits
- 20 000 seeded random 9-digit bodies (seed `20261022`), skipping the exhaustive prefix so the rest of the 10⁹ body space is sampled, not claimed
- App fixtures: example books in `src/lib/examples.ts` and the two verify-stacks ISBNs, plus their ISBN-10 and hyphenated forms
- Explicit rejects: empty, wrong lengths, last-digit-increment of the Pride and Prejudice ISBN, ISBN-13 with `X`, letters

Not exhaustive over all 10⁹ ISBN-10 bodies or all 10¹² ISBN-13 bodies.

## What this does not cover

- `fromGoogleBooks` / `fromOpenLibrary` / `pick` merge in `src/lib/lookup.ts` (network JSON, not checksums)
- Status (`owned|reading|read`) and rating `1..5` in `src/lib/books.ts` `cleanStatus` / `cleanRating` and the `books` CHECK constraints in `src/lib/db.ts`
- Duplicate rows: `insertBook` does not dedupe; `SCHEMA_SQL` has no unique `isbn`
- `normalizeBookInput`'s fallback `normalizeIsbn(input.isbn) || digitsKeep(input.isbn)` — **invalid ISBNs are still stored as stripped characters**. The harness does not import `books.ts` (extensionless `./db` import and a `pg` pool). If you tighten that fallback, add a new property and import the real function through a runner that can resolve it
- Camera decoding (`BarcodeDetector`, ZXing) and whether a frame is an EAN-13
- `yearFrom` / cover URL rewriting in `lookup.ts`

## Real bug vs modeling error

A **real bug** is: the command fails, the steps name a function in `src/lib/isbn.ts`, and the input is a concrete ISBN (or a punctuation variant). Trust that. Do not "fix" the harness to match wrong code. Report the counterexample. Do not change product code unless the user asked for a fix.

A **modeling error** is any of:

- You edited `isbn10Spec` / `isbn13Spec` / `specIsbn13CheckDigit` and the product file is unchanged
- A property never increments its check count (vacuous)
- You removed a guard in `src/lib/isbn.ts` (see mutations below) and the command still passes
- The failure input is not something `digitsOnly` / `normalizeIsbn` would see

`looksLikeIsbn` accepting a bad check digit is **specified behavior** (`P-looks-like-length`), not a checksum bug. The scan manual form can still no-op when `looksLikeIsbn` is true and `normalizeIsbn` is null — that UI gap is out of scope for this file.

## Mutations that must fail

If you need to know the harness can fail, break **one** line in `src/lib/isbn.ts`, run `npm run formal:isbn`, confirm the property below, then **discard** the scratch change. Do not commit the mutation.

| Scratch change | Property that must fail | Example counterexample |
| --- | --- | --- |
| `isIsbn13`: drop `isbn13CheckDigit(...) === value[12]` and return true after the regex | `P-isbn13-check` | `isIsbn13("9780141439519")` — GS1 sum fails, code returned true |
| `isIsbn10`: drop the check-digit compare and return true after the regex | `P-isbn10-check` | `isIsbn10("0141439514")` — ISO 2108 sum fails, code returned true |
| `normalizeIsbn`: `if (isIsbn10(raw)) return raw` (skip `isbn10To13`) | `P-normalize-accept` | `normalizeIsbn("0141439513")` was `0141439513`, not `9780141439518` |
| `isbn13CheckDigit`: always return `"0"` | `P-isbn13-check-digit-fn` | `isbn13CheckDigit("978014143951")` was `0`, unique valid digit is `8` |

Last vacuity check (do not commit the scratch): `isIsbn13` check-digit compare removed; `npm run formal:isbn` failed `P-isbn13-check` on `isIsbn13("9780141439519")` (expected false, got true). Product file restored; command passed with no findings.

## Intended product change

If ISBN rules are **supposed** to change (new 979 mapping, reject ISBN-10, make `looksLikeIsbn` check the digit):

1. Change `src/lib/isbn.ts` (and callers) first.
2. Update the matching property sentence, harm sentence, and oracle in `scripts/formal/isbn-verify.mts` so they still describe the new code, not the old code.
3. Run `npm run formal:isbn`. It must pass for the new rules and still fail the mutations above (or the updated mutation table).
4. Edit this skill's property table, bounds, and coverage if functions moved or were renamed.
5. Only then move **Code sync** to the current commit.

If the command fails and the change was **not** intended, it is a regression. Leave product code alone unless asked; quote the printed steps.

## Coverage record

| Check | File | Functions |
| --- | --- | --- |
| `P-isbn10-check` | `src/lib/isbn.ts` | `isIsbn10` |
| `P-isbn13-check` | `src/lib/isbn.ts` | `isIsbn13` |
| `P-isbn13-check-digit-fn` | `src/lib/isbn.ts` | `isbn13CheckDigit` |
| `P-isbn10-to-13` | `src/lib/isbn.ts` | `isbn10To13`, `isbn13CheckDigit` |
| `P-normalize-accept` | `src/lib/isbn.ts` | `normalizeIsbn`, `digitsOnly`, `isbn10To13` |
| `P-normalize-reject` | `src/lib/isbn.ts` | `normalizeIsbn`, `digitsOnly` |
| `P-equivalent-forms` | `src/lib/isbn.ts` | `normalizeIsbn`, `isbn10To13`, `digitsOnly` |
| `P-looks-like-length` | `src/lib/isbn.ts` | `looksLikeIsbn`, `digitsOnly` |
| `P-format-preserves-digits` | `src/lib/isbn.ts` | `formatIsbn`, `digitsOnly` |

Call sites that **depend** on the promise but are not executed by the harness: `lookupIsbn` in `src/lib/lookup.ts`, `GET` in `src/app/api/lookup/route.ts`, `accept` and manual submit in `src/components/scan-isbn.tsx`, `normalizeBookInput` in `src/lib/books.ts`.

## Code sync

Last confirmed at commit `18605f59caa2bc58f6cc2cc5d8b0f13f6e2ea418` (`src/lib/isbn.ts` unchanged since that commit; this skill and `scripts/formal/isbn-verify.mts` were added on top).

**Move this SHA forward only after** `npm run formal:isbn` passes and you have read `src/lib/isbn.ts` plus the harness properties and confirmed they still describe that commit's functions. Do not bump the SHA because a doc-only or unrelated commit landed.

To confirm you are still in sync:

```bash
git rev-parse HEAD
git log -1 --oneline -- src/lib/isbn.ts scripts/formal/isbn-verify.mts .cursor/skills/formal-verify-stacks/SKILL.md
npm run formal:isbn
```

If `src/lib/isbn.ts` moved and you have not re-read the properties, the SHA is stale even if the command still exits 0.
