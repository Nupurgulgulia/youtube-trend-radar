// ISO week ID such as "2026-W42". Each run, brief and email is keyed by this,
// so a second run in the same week can be detected and skipped.
export function isoWeekId(date: Date): string {
  // Work in UTC so the result does not depend on the server's time zone.
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  // ISO weeks start on Monday. Move to the Thursday of this week:
  // the year that Thursday falls in is the ISO year.
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const isoYear = d.getUTCFullYear();
  const yearStart = new Date(Date.UTC(isoYear, 0, 1));
  const week = Math.ceil(((d.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return `${isoYear}-W${String(week).padStart(2, "0")}`;
}
