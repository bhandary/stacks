const PALETTE = [
  { bg: "#3b1844", ink: "#f6e9d8" },
  { bg: "#1b2a4a", ink: "#e8eef8" },
  { bg: "#1c4a32", ink: "#e7f4ea" },
  { bg: "#5a2a12", ink: "#f8ead8" },
  { bg: "#1f3f4f", ink: "#e4f1f4" },
  { bg: "#4a1d2e", ink: "#f6e4ea" },
];

export function coverPalette(seed: string): { bg: string; ink: string } {
  let hash = 0;
  for (const char of seed) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return PALETTE[hash % PALETTE.length];
}
