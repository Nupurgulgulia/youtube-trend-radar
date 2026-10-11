// Live dry run of Gemini call 1 + the Theme Gate (checkpoint 6), using the most recent
// collection already in the database. Logs each Gemini call to llm_logs.
// It does NOT save themes, so a test can never show up as a "past theme" later.
// Run with: npm run themes:test

import { selectCandidates } from "@/lib/cluster";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { geminiGenerate } from "@/lib/gemini";
import { scoreVideos } from "@/lib/scorer";
import { insertLlmLogs, loadPastThemes, loadDayVideos, loadSettings, loadSnapshotHistories } from "@/lib/store";
import { runThemeGate } from "@/lib/theme-gate";
import { briefWeekId } from "@/lib/week";

async function main() {
  // The most recent day with snapshots, and the latest run (for logging Gemini calls).
  const [latest] = await db()`
    select observed_on::text as day, max(observed_at) as observed_at
    from video_snapshots group by observed_on order by observed_on desc limit 1`;
  const [run] = await db()`select id, week_id from runs order by started_at desc limit 1`;
  if (!latest || !run) throw new Error("No collected data found. Run npm run collect:test first.");
  const observedAt = new Date(latest.observed_at).toISOString();

  const settings = await loadSettings();
  const videos = scoreVideos(await loadDayVideos(latest.day), observedAt);
  const histories = await loadSnapshotHistories(videos.map((v) => v.videoId));
  const pastThemes = await loadPastThemes(briefWeekId(new Date(observedAt)));
  const candidates = selectCandidates(videos);
  const model = env("GEMINI_MODEL");

  console.log(`Run ${run.week_id}: ${videos.length} videos, ${candidates.length} sent to ${model}, ${pastThemes.length} past themes`);
  const perSource = new Map<string, number>();
  for (const c of candidates) for (const s of c.foundBy?.length ? c.foundBy : ["unknown"]) perSource.set(s, (perSource.get(s) ?? 0) + 1);
  console.log("Candidates per source:", Object.fromEntries([...perSource].sort()));

  const t0 = Date.now();
  const result = await runThemeGate({
    generate: geminiGenerate(env("GEMINI_API_KEY"), model),
    model,
    settings,
    candidates,
    allVideos: videos,
    histories,
    pastThemes,
    observedAt,
  });
  const ms = Date.now() - t0;
  await insertLlmLogs(run.id, result.logs);

  console.log("\n== Gemini calls");
  for (const l of result.logs) {
    console.log(`  attempt ${l.attempt}: ${l.ok ? "ok" : "failed"}, tokens in ${l.tokensIn ?? "?"}, out ${l.tokensOut ?? "?"}${l.error ? `, error: ${l.error}` : ""}`);
  }
  console.log(`  time: ${ms} ms`);

  console.log(`\n== Themes that passed the gate: ${result.themes.length}`);
  const byId = new Map(videos.map((v) => [v.videoId, v]));
  for (const t of result.themes) {
    const m = t.metrics;
    console.log(`\n* ${t.name} [${t.slug}] ${t.isNew ? "New this week" : `Recurring since ${t.recurringFromWeek}`}`);
    console.log(`  Gemini's reason: ${t.reason}`);
    console.log(`  ${m.videoCount} videos, ${m.creatorCount} creators, median views/day ${m.medianViewsPerDay}, band index ${m.medianBandIndex}, engagement ${m.medianEngagement} (n=${m.engagementSample})`);
    console.log(`  momentum: ${m.momentum} (${m.momentumReasons.join(" ")})`);
    console.log(`  confidence: ${m.confidence} (${m.confidenceReasons.join("; ")})`);
    for (const id of t.videoIds.slice(0, 4)) {
      const v = byId.get(id)!;
      console.log(`    - ${v.channelTitle} | ${v.title.slice(0, 70)}`);
    }
  }

  console.log(`\n== Dropped: ${result.dropped.length}`);
  for (const d of result.dropped) console.log(`  ${d.name}: ${d.errors.join("; ")}`);
  if (result.failure) console.log(`\nFAILURE: ${result.failure}`);
}

main().catch((e) => {
  console.error("Themes test failed:", e instanceof Error ? e.message.split("\n")[0] : "Unknown error");
  process.exit(1);
});
