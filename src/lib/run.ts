import { analyse, type AnalyseResult } from "./analyse";
import type { BriefContent } from "./brief";
import { collect, type CollectionResult } from "./collector";
import { briefEmail, failureEmail, type EmailMessage } from "./email";
import type { GenerateFn, LlmLog } from "./gemini";
import type { NewsItem } from "./news";
import type { SnapshotPoint } from "./momentum";
import type { QuotaBudget } from "./quota";
import type { Claim, RunFinish } from "./run-store";
import type { VideoInput } from "./scorer";
import type { StoredPastTheme } from "./theme-gate";
import type { Settings } from "./types";
import { isoWeekId } from "./week";
import type { YouTubeClient } from "./youtube";

// One weekly run, start to finish (map steps 2 to 15, in the order of the map).
// Every outside system is passed in, so the reliability rules can be tested with fakes.
//
// Email rules:
// - At most one email per week: the brief, or a short failure notice. Never a half-built brief.
// - A failed main run sends nothing, because the catch-up run may still succeed.
//   The failure notice goes out when the last chance fails: the catch-up run, a manual run,
//   or any run on its final attempt.
// - If sending fails, the claim is released so the next run can retry the email.

export type Trigger = "main" | "catchup" | "manual";

export type RunDeps = {
  now: () => Date;
  appUrl: string;
  defaultRecipient: string | null; // BRIEF_TO_EMAIL, used when Settings has no email
  fromEmail: string;
  budget: QuotaBudget;
  model: string;
  maxAttempts: number;
  youtube: () => YouTubeClient;
  fetchNews: (query: string) => Promise<NewsItem[]>;
  generate: GenerateFn;
  sendEmail: (msg: EmailMessage & { to: string; from: string; idempotencyKey: string }) => Promise<void>;
  store: {
    claimRun: (weekId: string) => Promise<Claim>;
    createLabelledRun: (label: string) => Promise<string>;
    finishRun: (runId: string, f: RunFinish) => Promise<void>;
    claimEmail: (weekId: string) => Promise<boolean>;
    releaseEmail: (weekId: string, reason: string) => Promise<void>;
    loadBriefContent: (weekId: string) => Promise<BriefContent | null>;
    loadSettings: () => Promise<Settings>;
    loadTrackedVideoIds: () => Promise<string[]>;
    upsertVideos: (videos: CollectionResult["videos"], seenAt: string) => Promise<void>;
    insertSnapshots: (snapshots: CollectionResult["snapshots"], runId: string) => Promise<number>;
    markUnavailable: (ids: string[]) => Promise<number>;
    loadDayVideos: (observedOn: string, ids: string[]) => Promise<VideoInput[]>;
    loadSnapshotHistories: (ids: string[]) => Promise<Map<string, SnapshotPoint[]>>;
    loadPastThemes: (beforeWeekId: string) => Promise<StoredPastTheme[]>;
    insertLlmLogs: (runId: string, logs: LlmLog[]) => Promise<void>;
    saveBrief: (runId: string, weekId: string, result: AnalyseResult) => Promise<void>;
  };
};

export type RunOutcome =
  | { action: "skipped"; weekId: string; reason: string }
  | { action: "email-retried"; weekId: string; email: EmailResult }
  | {
      action: "ran";
      weekId: string;
      runId: string;
      attempt: number;
      dryRun: boolean;
      status: "succeeded" | "thin" | "failed";
      error: string | null;
      email: EmailResult;
      timings: Record<string, number>;
    };

export type EmailResult = "sent" | "already-sent" | "not-sent" | "dry-run" | `failed: ${string}`;

const message = (e: unknown) => (e instanceof Error ? e.message.split("\n")[0].slice(0, 300) : "Unknown error");

async function sendOnce(deps: RunDeps, weekId: string, kind: "brief" | "failure", build: () => EmailMessage, recipient: string | null): Promise<EmailResult> {
  if (!(await deps.store.claimEmail(weekId))) return "already-sent";
  if (!recipient) {
    await deps.store.releaseEmail(weekId, "no recipient configured (Settings email or BRIEF_TO_EMAIL)");
    return "failed: no recipient configured";
  }
  try {
    await deps.sendEmail({ ...build(), to: recipient, from: deps.fromEmail, idempotencyKey: `${kind}-${weekId}` });
    return "sent";
  } catch (e) {
    await deps.store.releaseEmail(weekId, message(e));
    return `failed: ${message(e)}`;
  }
}

export async function runWeekly(deps: RunDeps, opts: { trigger: Trigger; dryRun: boolean }): Promise<RunOutcome> {
  const startedAt = deps.now();
  const weekId = isoWeekId(startedAt);
  const settings = await deps.store.loadSettings();
  const recipient = settings.email || deps.defaultRecipient;

  // 1. Lock (map step 2). Dry runs get their own label and never touch the week's lock.
  let runId: string;
  let attempt = 1;
  const label = opts.dryRun ? `dryrun-${startedAt.toISOString()}` : weekId;
  if (opts.dryRun) {
    runId = await deps.store.createLabelledRun(label);
  } else {
    const claim = await deps.store.claimRun(weekId);
    if (!claim.claimed) {
      const ex = claim.existing;
      // Finished, but the email never went out (for example Resend was down): retry only the email.
      if (ex && (ex.status === "succeeded" || ex.status === "thin") && !ex.emailSentAt) {
        const brief = await deps.store.loadBriefContent(weekId);
        if (brief) {
          const email = await sendOnce(deps, weekId, "brief", () => briefEmail(brief, deps.appUrl), recipient);
          return { action: "email-retried", weekId, email };
        }
      }
      const reason = !ex
        ? "no run row and could not create one"
        : ex.status === "running"
          ? `a run for ${weekId} is already in progress (started ${ex.startedAt})`
          : ex.status === "failed"
            ? `${weekId} already failed ${ex.attempt} times (limit ${deps.maxAttempts})`
            : `${weekId} already ${ex.status}`;
      return { action: "skipped", weekId, reason };
    }
    runId = claim.runId;
    attempt = claim.attempt;
  }

  const timings: Record<string, number> = {};
  const timed = async <T,>(stage: string, fn: () => Promise<T>) => {
    const t0 = Date.now();
    try {
      return await fn();
    } finally {
      timings[stage] = Date.now() - t0;
    }
  };

  let collection: CollectionResult | null = null;
  let logs: LlmLog[] = [];
  const finish = async (status: RunFinish["status"], error: string | null) => {
    await deps.store.finishRun(runId, {
      status,
      error,
      sourceReport: collection
        ? { ...collection.sourceReport, searchCalls: collection.quotaUsed.searchCalls, keywordsSkipped: collection.plan.keywordsSkipped }
        : {},
      stageTimings: timings,
      quotaEstimated: collection?.plan.estimate.generalUnits ?? null,
      quotaUsed: collection?.quotaUsed.generalUnits ?? 0,
      tokensIn: logs.reduce((s, l) => s + (l.tokensIn ?? 0), 0),
      tokensOut: logs.reduce((s, l) => s + (l.tokensOut ?? 0), 0),
    });
  };

  const fail = async (error: string): Promise<RunOutcome> => {
    await finish("failed", error);
    const lastChance = opts.trigger !== "main" || attempt >= deps.maxAttempts;
    const email: EmailResult = opts.dryRun
      ? "dry-run"
      : lastChance
        ? await sendOnce(deps, weekId, "failure", () => failureEmail(weekId, error, deps.appUrl), recipient)
        : "not-sent";
    return { action: "ran", weekId: label, runId, attempt, dryRun: opts.dryRun, status: "failed", error, email, timings };
  };

  try {
    // 2. Collect (steps 3, 4, 6) and store (step 5).
    const trackedIds = await deps.store.loadTrackedVideoIds();
    collection = await timed("collect_ms", () =>
      collect(settings, { youtube: deps.youtube(), fetchNews: deps.fetchNews, now: startedAt, budget: deps.budget, trackedIds }),
    );
    const c = collection;
    await timed("store_ms", async () => {
      await deps.store.upsertVideos(c.videos, c.observedAt);
      await deps.store.insertSnapshots(c.snapshots, runId);
      await deps.store.markUnavailable(c.unavailableIds);
    });
    if (c.youtubeFailed) return await fail(`YouTube collection failed: ${c.sourceReport.youtube.reason ?? "no videos"}`);

    // 3. Score, cluster, gate, write, gate (steps 7 to 11), using the stored numbers.
    const ids = c.snapshots.map((s) => s.videoId);
    const videos = await deps.store.loadDayVideos(c.observedAt.slice(0, 10), ids);
    const result = await timed("analyse_ms", async () =>
      analyse({
        weekId: label,
        observedAt: c.observedAt,
        settings,
        videos,
        histories: await deps.store.loadSnapshotHistories(ids),
        pastThemes: await deps.store.loadPastThemes(weekId),
        keywordNews: c.news.flatMap((n) => n.items),
        fetchNews: deps.fetchNews,
        generate: deps.generate,
        model: deps.model,
        coverage: {
          sources: c.sourceReport,
          keywordsSearched: c.plan.keywordsUsed,
          keywordsSkipped: c.plan.keywordsSkipped,
          quotaUsed: c.quotaUsed.generalUnits,
          quotaEstimated: c.plan.estimate.generalUnits,
          searchCalls: c.quotaUsed.searchCalls,
        },
      }),
    );
    logs = result.logs;
    Object.assign(timings, result.timings);
    await deps.store.insertLlmLogs(runId, logs);
    if (result.outcome === "failed" || !result.brief) return await fail(result.failure ?? "No theme passed the quality checks");

    // 4. Publish (step 12), then record the run (step 15) and email (step 13).
    const brief = result.brief;
    await timed("save_ms", () => deps.store.saveBrief(runId, label, result));
    await finish(result.outcome, null);
    const email: EmailResult = opts.dryRun
      ? "dry-run"
      : await sendOnce(deps, weekId, "brief", () => briefEmail(brief, deps.appUrl), recipient);
    return { action: "ran", weekId: label, runId, attempt, dryRun: opts.dryRun, status: result.outcome, error: null, email, timings };
  } catch (e) {
    return await fail(`Unexpected error: ${message(e)}`);
  }
}
