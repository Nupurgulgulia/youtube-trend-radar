import "server-only";
import type { BriefContent } from "./brief";
import { db } from "./db";

// Run archive and locks (map steps 2, 13 and 15). Each claim is ONE SQL statement, so two
// runs that start at the same moment (Vercel can deliver a cron twice) cannot both win.

export const MAX_ATTEMPTS = 2;
export const STALE_RUN_MINUTES = 15;

export type ExistingRun = {
  runId: string;
  status: string;
  attempt: number;
  startedAt: string;
  emailSentAt: string | null;
};

export type Claim = { claimed: true; runId: string; attempt: number } | { claimed: false; existing: ExistingRun | null };

// Starts this week's run if there is none, or if the last one failed (or crashed while
// "running" for 15+ minutes) and fewer than MAX_ATTEMPTS have been made.
export async function claimRun(weekId: string): Promise<Claim> {
  const rows = await db()`
    insert into runs (week_id, status, attempt, started_at)
    values (${weekId}, 'running', 1, now())
    on conflict (week_id) do update set
      status = 'running', attempt = runs.attempt + 1, started_at = now(),
      finished_at = null, error = null
    where runs.attempt < ${MAX_ATTEMPTS}
      and (runs.status = 'failed'
           or (runs.status = 'running' and runs.started_at < now() - make_interval(mins => ${STALE_RUN_MINUTES})))
    returning id, attempt`;
  if (rows.length > 0) return { claimed: true, runId: rows[0].id, attempt: rows[0].attempt };
  const [r] = await db()`select id, status, attempt, started_at, email_sent_at from runs where week_id = ${weekId}`;
  return {
    claimed: false,
    existing: r
      ? {
          runId: r.id,
          status: r.status,
          attempt: r.attempt,
          startedAt: new Date(r.started_at).toISOString(),
          emailSentAt: r.email_sent_at ? new Date(r.email_sent_at).toISOString() : null,
        }
      : null,
  };
}

// A dry run never touches the week's lock: it gets its own label.
export async function createLabelledRun(label: string): Promise<string> {
  const [r] = await db()`insert into runs (week_id, status) values (${label}, 'running') returning id`;
  return r.id;
}

export type RunFinish = {
  status: "succeeded" | "thin" | "failed";
  error: string | null;
  sourceReport: unknown;
  stageTimings: Record<string, number>;
  quotaEstimated: number | null;
  quotaUsed: number;
  tokensIn: number;
  tokensOut: number;
};

export async function finishRun(runId: string, f: RunFinish): Promise<void> {
  await db()`
    update runs set
      status = ${f.status}, finished_at = now(), error = ${f.error},
      source_report = ${JSON.stringify(f.sourceReport ?? {})}::jsonb,
      stage_timings = ${JSON.stringify(f.stageTimings)}::jsonb,
      quota_estimated = ${f.quotaEstimated}, quota_used = ${f.quotaUsed},
      tokens_in = ${f.tokensIn}, tokens_out = ${f.tokensOut}
    where id = ${runId}`;
}

// Email exactly once: only the caller that flips email_sent_at from null gets true.
export async function claimEmail(weekId: string): Promise<boolean> {
  const rows = await db()`
    update runs set email_sent_at = now()
    where week_id = ${weekId} and email_sent_at is null
    returning id`;
  return rows.length > 0;
}

// Sending failed: give the claim back so the catch-up run can try again, and record why.
export async function releaseEmail(weekId: string, reason: string): Promise<void> {
  await db()`
    update runs set email_sent_at = null,
      error = trim(both ' ' from coalesce(error, '') || ' Email failed: ' || ${reason})
    where week_id = ${weekId}`;
}

export async function loadBriefContent(weekId: string): Promise<BriefContent | null> {
  const [r] = await db()`select content from briefs where week_id = ${weekId}`;
  return r ? (r.content as BriefContent) : null;
}

export type RunRow = {
  weekId: string;
  status: string;
  attempt: number;
  startedAt: string;
  finishedAt: string | null;
  error: string | null;
  sourceReport: Record<string, unknown>;
  stageTimings: Record<string, number>;
  quotaEstimated: number | null;
  quotaUsed: number;
  tokensIn: number;
  tokensOut: number;
  emailSentAt: string | null;
};

export async function listRuns(limit = 30): Promise<RunRow[]> {
  const rows = await db()`
    select week_id, status, attempt, started_at, finished_at, error, source_report, stage_timings,
           quota_estimated, quota_used, tokens_in, tokens_out, email_sent_at
    from runs order by started_at desc limit ${limit}`;
  return rows.map((r) => ({
    weekId: r.week_id,
    status: r.status,
    attempt: r.attempt,
    startedAt: new Date(r.started_at).toISOString(),
    finishedAt: r.finished_at ? new Date(r.finished_at).toISOString() : null,
    error: r.error,
    sourceReport: r.source_report ?? {},
    stageTimings: r.stage_timings ?? {},
    quotaEstimated: r.quota_estimated,
    quotaUsed: r.quota_used,
    tokensIn: r.tokens_in,
    tokensOut: r.tokens_out,
    emailSentAt: r.email_sent_at ? new Date(r.email_sent_at).toISOString() : null,
  }));
}
