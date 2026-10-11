// Manual live test of the Collector (checkpoint 4). Calls the real YouTube API and
// Google News, then writes videos and snapshots to the database.
// Run with: npm run collect:test
//
// It records itself in `runs` under a "manual-collect-..." label, not an ISO week,
// so it never blocks the real Sunday run. It sends no email and makes no AI calls.
// Prints counts and titles only, never keys or the connection string.

import { collect } from "@/lib/collector";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { fetchNews } from "@/lib/news";
import { insertSnapshots, loadSettings, loadTrackedVideoIds, markUnavailable, upsertVideos } from "@/lib/store";
import { createYouTubeClient } from "@/lib/youtube";

async function main() {
  const now = new Date();
  const settings = await loadSettings();
  const trackedIds = await loadTrackedVideoIds();
  const youtube = createYouTubeClient({ apiKey: env("YOUTUBE_API_KEY") });

  const label = `manual-collect-${now.toISOString()}`;
  const [run] = await db()`insert into runs (week_id, status) values (${label}, 'running') returning id`;
  console.log(`Run ${label}`);

  // One-off check of the category assumption in docs/quota.md.
  const categories = await youtube.videoCategories(settings.regionCode);
  for (const id of settings.categoryIds) {
    const match = categories.find((c) => c.id === String(id));
    console.log(`Category ${id} in ${settings.regionCode}: ${match ? match.title : "NOT FOUND"}`);
  }

  const t0 = Date.now();
  const result = await collect(settings, {
    youtube,
    fetchNews: (q) => fetchNews(q),
    now,
    budget: {
      dailyQuota: env("YOUTUBE_DAILY_QUOTA"),
      searchDailyLimit: env("YOUTUBE_SEARCH_DAILY_LIMIT"),
      safetyMargin: env("QUOTA_SAFETY_MARGIN"),
    },
    trackedIds,
  });
  const collectMs = Date.now() - t0;

  await upsertVideos(result.videos, result.observedAt);
  const inserted = await insertSnapshots(result.snapshots, run.id);
  const flagged = await markUnavailable(result.unavailableIds);

  // Append-only check: writing the same snapshots again with different numbers must change nothing.
  const ids = result.snapshots.map((s) => s.videoId);
  const day = result.observedAt.slice(0, 10);
  const storedTotal = async () => {
    const [r] = await db()`
      select count(*)::int as n, coalesce(sum(views), 0)::bigint as total from video_snapshots
      where observed_on = ${day}::date and video_id = any(${ids}::text[])`;
    return { n: r.n as number, total: Number(r.total) };
  };
  const before = await storedTotal();
  const tampered = result.snapshots.map((s) => ({ ...s, views: s.views + 1_000_000 }));
  const reinserted = await insertSnapshots(tampered, run.id);
  const after = await storedTotal();

  const totalUnits = result.quotaUsed.generalUnits + 1; // + the category check
  await db()`
    update runs set
      status = ${result.youtubeFailed ? "failed" : "succeeded"},
      finished_at = now(),
      error = ${result.youtubeFailed ? result.sourceReport.youtube.reason : null},
      source_report = ${JSON.stringify({ ...result.sourceReport, searchCalls: result.quotaUsed.searchCalls, keywordsSkipped: result.plan.keywordsSkipped })}::jsonb,
      stage_timings = ${JSON.stringify({ collect_ms: collectMs })}::jsonb,
      quota_estimated = ${result.plan.estimate.generalUnits},
      quota_used = ${totalUnits}
    where id = ${run.id}`;

  const bySource = (prefix: string) => result.videos.filter((v) => v.foundBy.some((f) => f.startsWith(prefix))).length;
  console.log("\n== Collection");
  console.log(`Videos collected: ${result.videos.length} (trending ${bySource("trending")}, search ${bySource("search")}, tracked ${bySource("tracked")})`);
  console.log(`Distinct channels: ${new Set(result.videos.map((v) => v.channelId)).size}`);
  console.log(`Without view count (no snapshot): ${result.videos.length - result.snapshots.length}`);
  console.log(`Keywords used: ${result.plan.keywordsUsed.join(", ")}`);
  console.log(`Keywords skipped: ${result.plan.keywordsSkipped.map((s) => s.keyword).join(", ") || "none"}`);
  console.log(`News headlines: ${result.news.map((n) => `${n.query}=${n.items.length}`).join(", ")}`);
  console.log(`Time: ${collectMs} ms`);

  console.log("\n== Sources");
  console.log(`YouTube: ${result.sourceReport.youtube.status}${result.sourceReport.youtube.reason ? ` (${result.sourceReport.youtube.reason})` : ""}`);
  console.log(`News: ${result.sourceReport.news.status}${result.sourceReport.news.reason ? ` (${result.sourceReport.news.reason})` : ""}`);
  for (const d of result.sourceReport.details.filter((x) => x.status === "failed")) {
    console.log(`  failed ${d.source}: ${d.reason}`);
  }

  console.log("\n== Quota");
  console.log(`General units: estimated ${result.plan.estimate.generalUnits} (worst case), used ${totalUnits} incl. category check`);
  console.log(`Search calls: estimated ${result.plan.estimate.searchCalls}, used ${result.quotaUsed.searchCalls}`);

  console.log("\n== Database");
  console.log(`Snapshots inserted: ${inserted}; unavailable flagged: ${flagged}`);
  console.log(`Re-insert with changed numbers inserted: ${reinserted} (must be 0)`);
  console.log(`Stored view total unchanged by the re-insert: ${before.total === after.total} (${after.n} rows for ${day})`);
  if (inserted < result.snapshots.length) {
    console.log(`  ${result.snapshots.length - inserted} videos already had a snapshot today: their numbers were kept, only found_by was merged.`);
  }

  console.log("\n== Sample (top 5 by views)");
  for (const v of [...result.videos].sort((a, b) => (b.views ?? 0) - (a.views ?? 0)).slice(0, 5)) {
    console.log(`  ${v.views ?? "?"} views | ${v.channelTitle} | ${v.title.slice(0, 70)}`);
  }
  const sampleNews = result.news.find((n) => n.items.length > 0)?.items[0];
  if (sampleNews) console.log(`  news: ${sampleNews.title.slice(0, 80)} (${sampleNews.source ?? "unknown source"})`);
}

main().catch((e) => {
  console.error("Collector test failed:", e instanceof Error ? e.message : "Unknown error");
  process.exit(1);
});
