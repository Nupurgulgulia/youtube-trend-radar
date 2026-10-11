// Display helpers for the brief page and email. Indian digit grouping (1,38,859).

const intFmt = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 });

export const fmtInt = (n: number | null | undefined) => (n === null || n === undefined ? "n/a" : intFmt.format(n));

export const fmtDate = (iso: string | null | undefined) => {
  if (!iso) return "date unknown";
  const d = new Date(iso.length === 10 ? `${iso}T00:00:00Z` : iso);
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" });
};

export const momentumLabel: Record<string, string> = {
  rising: "Rising",
  established: "Established",
  fading: "Fading",
  insufficient_evidence: "Insufficient evidence",
};

export const decisionLabel: Record<string, string> = { film: "Film", skip: "Skip", investigate: "Investigate" };

export const groupLabel = (g: string) => g.replace("_", " ");
