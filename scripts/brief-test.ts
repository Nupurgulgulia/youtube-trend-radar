// Live dry run of steps 7 to 11 (checkpoint 7): score, cluster + Theme Gate, news,
// write + Publish Gate, using the most recent collection in the database.
// Logs Gemini calls to llm_logs. Does NOT save themes or a brief, and sends no email.
// Optional: a path to write the brief JSON to, and --save to store it as a test preview
// (week label "preview-<date>"), which the brief page and archive show as a test.
// Run with: npm run brief:test -- [--save] [preview path]

import { writeFileSync } from "node:fs";
import { analyse } from "@/lib/analyse";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { geminiGenerate } from "@/lib/gemini";
import { fetchNews, type NewsItem } from "@/lib/news";
import { saveBrief } from "@/lib/brief-store";
import { insertLlmLogs, loadDayVideos, loadPastThemes, loadSettings, loadSnapshotHistories } from "@/lib/store";
import { briefWeekId } from "@/lib/week";

async function main() {
  const [latest] = await db()`
    select observed_on::text as day, max(observed_at) as observed_at
    from video_snapshots group by observed_on order by observed_on desc limit 1`;
  const [run] = await db()`select id, week_id, source_report, quota_used, quota_estimated from runs order by started_at desc limit 1`;
  if (!latest || !run) throw new Error("No collected data found. Run npm run collect:test first.");
  const observedAt = new Date(latest.observed_at).toISOString();
  const weekId = briefWeekId(new Date(observedAt));

  const settings = await loadSettings();
  const videos = await loadDayVideos(latest.day);
  const keywordNews: NewsItem[] = [];
  for (const k of settings.keywords) keywordNews.push(...(await fetchNews(k).catch(() => [])));
  const model = env("GEMINI_MODEL");

  const result = await analyse({
    weekId,
    observedAt,
    settings,
    videos,
    histories: await loadSnapshotHistories(videos.map((v) => v.videoId)),
    pastThemes: await loadPastThemes(weekId),
    keywordNews,
    fetchNews: (q) => fetchNews(q),
    generate: geminiGenerate(env("GEMINI_API_KEY"), model),
    model,
    coverage: {
      sources: run.source_report?.youtube ? run.source_report : null,
      keywordsSearched: settings.keywords,
      keywordsSkipped: run.source_report?.keywordsSkipped ?? [],
      quotaUsed: run.quota_used,
      quotaEstimated: run.quota_estimated,
      searchCalls: run.source_report?.searchCalls ?? null,
    },
  });
  await insertLlmLogs(run.id, result.logs);

  console.log(`Week ${weekId} (dry run on ${latest.day} data): outcome ${result.outcome.toUpperCase()}`);
  console.log("\n== Gemini calls");
  for (const l of result.logs) {
    console.log(`  ${l.task} attempt ${l.attempt}: ${l.ok ? "ok" : "failed"}, tokens in ${l.tokensIn ?? "?"}, out ${l.tokensOut ?? "?"}${l.error ? `, ${l.error}` : ""}`);
  }
  console.log("  timings:", result.timings);
  if (result.newsErrors.length) console.log("  news errors:", result.newsErrors);

  if (result.publish && result.publish.errors.length) {
    console.log("\n== Still failing after the retry");
    result.publish.errors.forEach((e) => console.log(`  ${e}`));
  }
  if (!result.brief) {
    console.log(`\nNo brief: ${result.failure}`);
    return;
  }

  const b = result.brief;
  console.log(`\n== Executive summary${b.summaryFromCode ? " (code fallback)" : ""}\n${b.executiveSummary}`);
  console.log("\n== Top opportunities");
  b.topOpportunities.forEach((o) => console.log(`  ${o.name}: ${o.reason}`));
  for (const t of b.themes) {
    console.log(`\n* ${t.name} | ${t.momentum} | ${t.confidence} | ${t.isNew ? "New this week" : `Recurring since ${t.recurringFromWeek}`}`);
    console.log(`  measured: ${t.measured.video_count} videos, ${t.measured.creator_count} creators, median ${t.measured.median_views_per_day} views/day, ${t.measured.views_per_day_vs_same_age_videos}x same-age, engagement ${t.measured.median_engagement_percent}%`);
    console.log(`  news matched: ${t.news.length}${t.chosenNews ? `, used: ${t.chosenNews.title} (${t.chosenNews.source})` : ""}`);
    if (!t.written) {
      console.log(`  ${t.writtenNote}`);
      continue;
    }
    for (const [k, v] of Object.entries(t.written)) console.log(`  ${k}: ${v}`);
  }
  console.log(`\n== Coverage: ${b.coverage.videosScanned} videos, ${b.coverage.creators} creators, first run ${b.coverage.firstRun}`);
  b.coverage.limitations.forEach((l) => console.log(`  - ${l}`));

  if (process.argv.includes("--save")) {
    const label = `preview-${latest.day}`;
    b.weekId = label;
    await saveBrief(run.id, label, result);
    console.log(`\nSaved as test preview ${label}: open /brief/${label}`);
  }

  const out = process.argv.slice(2).find((a) => !a.startsWith("--"));
  if (out) {
    writeFileSync(out, JSON.stringify(b, null, 2));
    console.log(`\nPreview written to ${out}`);
  }
}

main().catch((e) => {
  console.error("Brief test failed:", e instanceof Error ? e.message.split("\n")[0] : "Unknown error");
  process.exit(1);
});
