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

const IST_OFFSET_MS = 5.5 * 3600_000;

// The week a brief belongs to: the ISO week of the most recent Sunday in India time.
// ISO weeks end on Sunday, so the Sunday cron runs get that week's ID. A manual run on
// a weekday is treated as a late brief for the Sunday just gone, so it can never use up
// next Sunday's run (on Monday 12 Oct 2026, plain isoWeekId would say W42, the same
// week as Sunday 18 Oct, and the Sunday run would then skip).
export function briefWeekId(now: Date): string {
  const ist = new Date(now.getTime() + IST_OFFSET_MS); // read its UTC fields as IST
  const sunday = new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate() - ist.getUTCDay()));
  return isoWeekId(sunday);
}
