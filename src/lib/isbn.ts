const ISBN_10_WEIGHTS = [10, 9, 8, 7, 6, 5, 4, 3, 2];

export function digitsOnly(value: string): string {
  return value.replace(/[^0-9Xx]/g, "").toUpperCase();
}

export function isIsbn13(value: string): boolean {
  if (!/^\d{13}$/.test(value)) return false;
  return isbn13CheckDigit(value.slice(0, 12)) === value[12];
}

export function isIsbn10(value: string): boolean {
  if (!/^\d{9}[\dX]$/.test(value)) return false;
  let sum = 0;
  for (let i = 0; i < 9; i++) {
    sum += Number(value[i]) * ISBN_10_WEIGHTS[i];
  }
  const check = (11 - (sum % 11)) % 11;
  const expected = check === 10 ? "X" : String(check);
  return value[9] === expected;
}

export function isbn13CheckDigit(body12: string): string {
  let sum = 0;
  for (let i = 0; i < 12; i++) {
    sum += Number(body12[i]) * (i % 2 === 0 ? 1 : 3);
  }
  return String((10 - (sum % 10)) % 10);
}

export function isbn10To13(isbn10: string): string {
  const body = `978${isbn10.slice(0, 9)}`;
  return `${body}${isbn13CheckDigit(body)}`;
}

export function normalizeIsbn(value: string): string | null {
  const raw = digitsOnly(value);
  if (isIsbn13(raw)) return raw;
  if (isIsbn10(raw)) return isbn10To13(raw);
  return null;
}

export function formatIsbn(value: string): string {
  const isbn = digitsOnly(value);
  if (isbn.length === 13) {
    return `${isbn.slice(0, 3)}-${isbn.slice(3, 12)}-${isbn.slice(12)}`;
  }
  if (isbn.length === 10) {
    return `${isbn.slice(0, 9)}-${isbn.slice(9)}`;
  }
  return value;
}

export function looksLikeIsbn(value: string): boolean {
  const raw = digitsOnly(value);
  return raw.length === 10 || raw.length === 13;
}
