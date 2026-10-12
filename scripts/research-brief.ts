// On-demand research brief: runs the same pipeline as the Sunday run (collector, Scorer,
// Gemini Flash clustering + Theme Gate, Gemini writing + Publish Gate) with its own topic
// and keywords, and saves it under a "research-..." label.
// It does NOT change Settings, never touches the weekly lock, and sends no email.
// Run with: npm run research -- <config.json>
//   config: { "slug": "ps5-jailbreak", "topic": "...", "keywords": [...], "categories": [...],
//             "regionCode": "US", "categoryIds": [20] }

import { readFileSync } from "node:fs";
import { analyse } from "@/lib/analyse";
import { saveBrief } from "@/lib/brief-store";
import { collect } from "@/lib/collector";
import { env } from "@/lib/env";
import { geminiGenerate } from "@/lib/gemini";
import { fetchNews } from "@/lib/news";
import { createLabelledRun, finishRun } from "@/lib/run-store";
import { insertLlmLogs, insertSnapshots, loadDayVideos, loadSettings, loadSnapshotHistories, markUnavailable, upsertVideos } from "@/lib/store";
import type { Settings } from "@/lib/types";
import { createYouTubeClient } from "@/lib/youtube";

type Config = { slug: string; topic: string; keywords: string[]; categories: string[]; regionCode?: string; categoryIds?: number[] };

async function main() {
  const cfgPath = process.argv[2];
  if (!cfgPath) throw new Error("Usage: npm run research -- <config.json>");
  const cfg = JSON.parse(readFileSync(cfgPath, "utf8")) as Config;
  const base = await loadSettings();
  const settings: Settings = {
    ...base,
    keywords: cfg.keywords,
    categories: cfg.categories,
    regionCode: cfg.regionCode ?? base.regionCode,
    categoryIds: cfg.categoryIds ?? base.categoryIds,
  };

  const now = new Date();
  const label = `research-${cfg.slug}-${now.toISOString().slice(0, 10)}`;
  const runId = await createLabelledRun(label);
  const youtube = createYouTubeClient({ apiKey: env("YOUTUBE_API_KEY") });
  const model = env("GEMINI_MODEL");
  console.log(`Research run ${label}: ${settings.keywords.length} keywords, region ${settings.regionCode}, categories ${settings.categoryIds.join(",")}`);

  for (const id of settings.categoryIds) {
    const cats = await youtube.videoCategories(settings.regionCode);
    console.log(`  category ${id}: ${cats.find((c) => c.id === String(id))?.title ?? "NOT FOUND"}`);
  }

  const timings: Record<string, number> = {};
  const t0 = Date.now();
  const c = await collect(settings, {
    youtube,
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
  console.log(`  collected ${c.videos.length} videos; YouTube ${c.sourceReport.youtube.status}, news ${c.sourceReport.news.status}`);

  const ids = c.snapshots.map((s) => s.videoId);
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

  const finish = (status: "succeeded" | "thin" | "failed", error: string | null) =>
    finishRun(runId, {
      status,
      error,
      sourceReport: { ...c.sourceReport, searchCalls: c.quotaUsed.searchCalls, keywordsSkipped: c.plan.keywordsSkipped },
      stageTimings: timings,
      quotaEstimated: c.plan.estimate.generalUnits,
      quotaUsed: c.quotaUsed.generalUnits,
      tokensIn: result.logs.reduce((s, l) => s + (l.tokensIn ?? 0), 0),
      tokensOut: result.logs.reduce((s, l) => s + (l.tokensOut ?? 0), 0),
    });

  for (const l of result.logs) console.log(`  ${l.task} attempt ${l.attempt}: ${l.ok ? "ok" : `failed (${l.error})`}`);
  if (!result.brief) {
    await finish("failed", result.failure);
    console.log(`No brief: ${result.failure}`);
    process.exitCode = 1;
    return;
  }
  result.brief.researchTopic = cfg.topic;
  await saveBrief(runId, label, result);
  await finish(result.outcome as "succeeded" | "thin", null);

  console.log(`\nOutcome: ${result.outcome}. Themes:`);
  for (const t of result.brief.themes) {
    console.log(`  * ${t.name} | ${t.momentum} | ${t.confidence} | ${t.measured.video_count} videos, ${t.measured.creator_count} creators | written: ${t.written ? "passed" : "evidence only"}`);
  }
  if (result.publish?.errors.length) console.log("  Publish Gate still failing:", result.publish.errors.slice(0, 5));
  console.log(`\nSaved. Open /brief/${label}`);
}

main().catch((e) => {
  console.error("Research brief failed:", e instanceof Error ? e.message.split("\n")[0] : "Unknown error");
  process.exitCode = 1;
});
