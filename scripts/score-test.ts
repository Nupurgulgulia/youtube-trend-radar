// Runs the Scorer on the most recent collection stored in the database (checkpoint 5).
// Read-only: no API calls, no AI, nothing written.
// Run with: npm run score:test

import { db } from "@/lib/db";
import { findings, type GroupStat } from "@/lib/findings";
import { scoreVideos } from "@/lib/scorer";
import { distinct } from "@/lib/stats";
import { loadRunVideos } from "@/lib/store";

const fmt = (g: GroupStat) =>
  `${g.group.padEnd(14)} videos ${String(g.videos).padStart(3)}  creators ${String(g.creators).padStart(3)}  ` +
  `median views/day ${String(g.medianViewsPerDay ?? "n/a").padStart(8)}  band index ${String(g.medianBandIndex ?? "n/a").padStart(5)}  ` +
  `engagement ${g.medianEngagement ?? "n/a"} (n=${g.engagementSample})${g.comparable ? "" : "  [too small]"}`;

async function main() {
  const [run] = await db()`
    select r.id, r.week_id, max(s.observed_at) as observed_at
    from runs r join video_snapshots s on s.run_id = r.id
    group by r.id order by max(s.observed_at) desc limit 1`;
  if (!run) throw new Error("No collected run found. Run npm run collect:test first.");

  const videos = scoreVideos(await loadRunVideos(run.id), new Date(run.observed_at).toISOString());
  console.log(`Run ${run.week_id}: ${videos.length} videos, ${distinct(videos.map((v) => v.channelId))} creators`);

  const bands = new Map<string, number>();
  for (const v of videos) bands.set(v.ageBand, (bands.get(v.ageBand) ?? 0) + 1);
  console.log("Age bands:", Object.fromEntries(bands));
  console.log(`Engagement available: ${videos.filter((v) => v.engagementRate !== null).length} of ${videos.length}`);

  const f = findings(videos);
  console.log("\n== Formats (all videos)");
  f.formats.forEach((g) => console.log(fmt(g)));
  console.log("Comparison:", f.formatComparison.status === "ranked" ? f.formatComparison.ranking.map((r) => `${r.group} ${r.medianBandIndex}`).join(" > ") : f.formatComparison.message);
  console.log("\n== Lengths (all videos)");
  f.lengths.forEach((g) => console.log(fmt(g)));
  console.log("Comparison:", f.lengthComparison.status === "ranked" ? f.lengthComparison.ranking.map((r) => `${r.group} ${r.medianBandIndex}`).join(" > ") : f.lengthComparison.message);

  console.log("\n== Formats within each length bucket");
  for (const b of f.formatsByLength) {
    const c = b.comparison.status === "ranked" ? b.comparison.ranking.map((r) => `${r.group} ${r.medianBandIndex}`).join(" > ") : b.comparison.message;
    console.log(`  ${b.length.padEnd(6)} ${c}`);
  }

  console.log("\n== Sample format labels");
  for (const format of ["comparison", "review", "tutorial", "list", "news_reaction", "explainer", "other"]) {
    const ex = videos.filter((v) => v.format === format).slice(0, 2);
    for (const v of ex) console.log(`  ${format.padEnd(14)} ${v.title.slice(0, 75)}`);
  }
}

main().catch((e) => {
  console.error("Score test failed:", e instanceof Error ? e.message : "Unknown error");
  process.exit(1);
});
