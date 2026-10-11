// Vercel Cron schedules (map step 2). Vercel Cron runs in UTC; IST is UTC+5:30.
// Must match vercel.json. Vercel sends the triggering expression in the
// x-vercel-cron-schedule header, which is how the route tells the two apart.
// On the Hobby plan each job may fire any time within its hour (checked 2026-10-11).

export const MAIN_SCHEDULE = "30 0 * * 0"; // Sunday 00:30 UTC = 06:00 IST (may run until 07:29 IST)
export const CATCHUP_SCHEDULE = "30 3 * * 0"; // Sunday 03:30 UTC = 09:00 IST (may run until 10:29 IST)
