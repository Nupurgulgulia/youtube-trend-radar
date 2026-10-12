import "server-only";
import { analyse } from "./analyse";
import { saveBrief } from "./brief-store";
import { collect } from "./collector";
import { db } from "./db";
import { env } from "./env";
import { geminiGenerate } from "./gemini";
import { fetchNews } from "./news";
import { createLabelledRun, finishRun } from "./run-store";
import { researchLabel, searchBudgetCheck, type ResearchInput } from "./research-form";
import { insertLlmLogs, insertSnapshots, loadDayVideos, loadSettings, loadSnapshotHistories, markUnavailable, upsertVideos } from "./store";
import type { Settings } from "./types";
import { createYouTubeClient } from "./youtube";

// Research briefs: the Sunday pipeline (collector, Scorer, Gemini Flash + Theme Gate,
// Gemini Flash + Publish Gate) run on request with its own topic and keywords.
// Used by the website (POST /api/research) and by `npm run research`.
// Never changes Settings, never touches the weekly lock, never emails.

export type ResearchResult =
  | { ok: true; label: string; outcome: "succeeded" | "thin"; themes: string[] }
  | { ok: false; error: string; label?: string };

const RUNNING_WINDOW_MINUTES = 10;

// Searches already spent in the current Pacific-time quota day, across all runs.
async function searchesUsedToday(): Promise<number> {
  const [r] = await db()`
    select coalesce(sum((source_report->>'searchCalls')::int), 0)::int as used
    from runs
    where started_at >= (date_trunc('day', now() at time zone 'America/Los_Angeles') at time zone 'America/Los_Angeles')`;
  return Number(r.used);
}

async function researchAlreadyRunning(): Promise<boolean> {
  const rows = await db()`
    select 1 from runs
    where week_id like 'research-%' and status = 'running'
      and started_at > now() - make_interval(mins => ${RUNNING_WINDOW_MINUTES})
    limit 1`;
  return rows.length > 0;
}

export async function runResearch(input: ResearchInput, now = new Date()): Promise<ResearchResult> {
  if (await researchAlreadyRunning()) {
    return { ok: false, error: "Another research is already running. Wait for it to finish (about 2 minutes) and try again." };
  }
  const quotaProblem = searchBudgetCheck(await searchesUsedToday(), input.keywords.length, env("YOUTUBE_SEARCH_DAILY_LIMIT"));
  if (quotaProblem) return { ok: false, error: quotaProblem };

  const saved = await loadSettings();
  const settings: Settings = {
    ...saved,
    categories: [input.topic],
    keywords: input.keywords,
    regionCode: input.regionCode,
    categoryIds: input.categoryIds,
  };
  const label = researchLabel(input.topic, now);
  const runId = await createLabelledRun(label);
  const timings: Record<string, number> = {};

  try {
    const t0 = Date.now();
    const c = await collect(settings, {
      youtube: createYouTubeClient({ apiKey: env("YOUTUBE_API_KEY") }),
      fetchNews: (q) => fetchNews(q),
      now,
      budget: {
        dailyQuota: env("YOUTUBE_DAILY_QUOTA"),
        searchDailyLimit: env("YOUTUBE_SEARCH_DAILY_LIMIT"),
        safetyMargin: env("QUOTA_SAFETY_MARGIN"),
      },
      trackedIds: [],
    });
    timings.collect_ms = Date.now() - t0;
    await upsertVideos(c.videos, c.observedAt);
    await insertSnapshots(c.snapshots, runId);
    await markUnavailable(c.unavailableIds);

    const report = { ...c.sourceReport, searchCalls: c.quotaUsed.searchCalls, keywordsSkipped: c.plan.keywordsSkipped };
    const runInfo = {
      sourceReport: report,
      quotaEstimated: c.plan.estimate.generalUnits,
      quotaUsed: c.quotaUsed.generalUnits,
    };

    if (c.youtubeFailed) {
      const error = `YouTube collection failed: ${c.sourceReport.youtube.reason ?? "no videos"}`;
      await finishRun(runId, { ...runInfo, status: "failed", error, stageTimings: timings, tokensIn: 0, tokensOut: 0 });
      return { ok: false, error, label };
    }

    const ids = c.snapshots.map((s) => s.videoId);
    const model = env("GEMINI_MODEL");
    const result = await analyse({
      weekId: label,
      observedAt: c.observedAt,
      settings,
      videos: await loadDayVideos(c.observedAt.slice(0, 10), ids),
      histories: await loadSnapshotHistories(ids),
      pastThemes: [],
      keywordNews: c.news.flatMap((n) => n.items),
      fetchNews: (q) => fetchNews(q),
      generate: geminiGenerate(env("GEMINI_API_KEY"), model),
      model,
      coverage: {
        sources: c.sourceReport,
        keywordsSearched: c.plan.keywordsUsed,
        keywordsSkipped: c.plan.keywordsSkipped,
        quotaUsed: c.quotaUsed.generalUnits,
        quotaEstimated: c.plan.estimate.generalUnits,
        searchCalls: c.quotaUsed.searchCalls,
      },
    });
    Object.assign(timings, result.timings);
    await insertLlmLogs(runId, result.logs);
    const tokens = {
      tokensIn: result.logs.reduce((s, l) => s + (l.tokensIn ?? 0), 0),
      tokensOut: result.logs.reduce((s, l) => s + (l.tokensOut ?? 0), 0),
    };

    if (!result.brief || result.outcome === "failed") {
      const error = result.failure ?? "No theme passed the quality checks.";
      await finishRun(runId, { ...runInfo, ...tokens, status: "failed", error, stageTimings: timings });
      return { ok: false, error: `No research brief: ${error} Try broader keywords.`, label };
    }

    result.brief.researchTopic = input.topic;
    await saveBrief(runId, label, result);
    await finishRun(runId, { ...runInfo, ...tokens, status: result.outcome, error: null, stageTimings: timings });
    return { ok: true, label, outcome: result.outcome, themes: result.brief.themes.map((t) => t.name) };
  } catch (e) {
    const error = `Unexpected error: ${e instanceof Error ? e.message.split("\n")[0].slice(0, 200) : "unknown"}`;
    await finishRun(runId, {
      status: "failed", error, sourceReport: {}, stageTimings: timings,
      quotaEstimated: null, quotaUsed: 0, tokensIn: 0, tokensOut: 0,
    }).catch(() => {});
    return { ok: false, error, label };
  }
}
