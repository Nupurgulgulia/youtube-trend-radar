// Command-line version of the website's "Start research" button. Same code (src/lib/research.ts):
// same quota guard, same pipeline, saved under a "research-..." label. No email, no Settings change.
// Run with: npm run research -- <config.json>
//   config: { "topic": "...", "keywords": [...], "regionCode": "US", "categoryIds": [20] }

import { readFileSync } from "node:fs";
import { runResearch } from "@/lib/research";
import { parseResearchForm } from "@/lib/research-form";

async function main() {
  const cfgPath = process.argv[2];
  if (!cfgPath) throw new Error("Usage: npm run research -- <config.json>");
  const cfg = JSON.parse(readFileSync(cfgPath, "utf8")) as { topic: string; keywords?: string[]; regionCode?: string; categoryIds?: number[] };
  const parsed = parseResearchForm({
    topic: cfg.topic,
    keywords: (cfg.keywords ?? []).join("\n"),
    regionCode: cfg.regionCode ?? "IN",
    categoryId: cfg.categoryIds?.[0] ?? 0,
  });
  if (!parsed.ok) throw new Error(parsed.errors.join(" "));

  console.log(`Researching "${parsed.input.topic}" (${parsed.input.keywords.length} searches, region ${parsed.input.regionCode})...`);
  const result = await runResearch(parsed.input);
  if (!result.ok) {
    console.log(`Failed: ${result.error}`);
    process.exitCode = 1;
    return;
  }
  console.log(`Outcome: ${result.outcome}. Themes:\n${result.themes.map((t) => `  * ${t}`).join("\n")}`);
  console.log(`Saved. Open /brief/${result.label}`);
}

main().catch((e) => {
  console.error("Research failed:", e instanceof Error ? e.message.split("\n")[0] : "Unknown error");
  process.exitCode = 1;
});
