// Small statistics helpers. Medians, not averages: one viral video should not
// decide what "typical" means.

export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

export const DAY_MS = 86_400_000;

export const daysBetween = (fromIso: string, toIso: string) =>
  (new Date(toIso).getTime() - new Date(fromIso).getTime()) / DAY_MS;

export const distinct = <T,>(xs: T[]) => new Set(xs).size;

// Rounds for display and storage. Gemini only ever sees these rounded values.
export const round = (x: number | null, digits = 2) =>
  x === null ? null : Math.round(x * 10 ** digits) / 10 ** digits;
