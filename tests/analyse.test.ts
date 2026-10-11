import { describe, expect, it } from "vitest";
import { analyse } from "@/lib/analyse";
import type { GenerateFn } from "@/lib/gemini";
import { NO_NEWS, type ThemeEvidence } from "@/lib/write";
import { defaultSettings } from "./fixtures/settings";
import { goodThemes, observedAt, videos } from "./fixtures/themes";

// Fake Gemini: answers the cluster call with fixed themes, and the write call by
// echoing each theme's labels from the evidence in the prompt, with number-free text.
function fakeGemini(clusterThemes: unknown[]) {
  let calls = 0;
  const generate: GenerateFn = async (req) => {
    calls++;
    if (req.prompt.startsWith("Creator's categories")) {
      return { text: JSON.stringify({ themes: clusterThemes }), tokensIn: 1, tokensOut: 1 };
    }
    const evidence: ThemeEvidence[] = JSON.parse(req.prompt.slice(req.prompt.indexOf("{"))).themes;
    return {
      text: JSON.stringify({
        executive_summary: "A few topics are popular with several creators this week.",
        top_opportunities: [{ slug: evidence[0].slug, reason: "Several creators are covering it." }],
        themes: evidence.map((e) => ({
          slug: e.slug,
          momentum: e.momentum,
          confidence: e.confidence,
          why_this_week: "Several creators covered it this week.",
          youtube_evidence: "The measured numbers are in the evidence box.",
          news_index: null,
          outside_context: NO_NEWS,
          interpretation: "Interpretation: viewers are curious.",
          filming_angle: "A hands-on Indian price comparison.",
          uncertain: "There is no history yet.",
        })),
      }),
      tokensIn: 1,
      tokensOut: 1,
    };
  };
  return { generate, calls: () => calls };
}

const run = (clusterThemes: unknown[]) => {
  const fake = fakeGemini(clusterThemes);
  return analyse({
    weekId: "2026-W41",
    observedAt,
    settings: defaultSettings,
    videos,
    histories: new Map(),
    pastThemes: [],
    keywordNews: [],
    fetchNews: async () => [],
    generate: fake.generate,
    model: "gemini-test-flash",
    coverage: { sources: null, keywordsSearched: ["AI tools"], keywordsSkipped: [], quotaUsed: 15, quotaEstimated: 14, searchCalls: 6 },
  }).then((r) => ({ ...r, calls: fake.calls() }));
};

describe("analyse (steps 7 to 11)", () => {
  it("publishes a succeeded brief with 3 themes in 2 Gemini calls", async () => {
    const r = await run(goodThemes);
    expect(r.outcome).toBe("succeeded");
    expect(r.calls).toBe(2);
    expect(r.brief!.themes).toHaveLength(3);
    expect(r.brief!.themes.every((t) => t.written !== null && t.writtenNote === null)).toBe(true);
    expect(r.brief!.thinWeekNote).toBeNull();
    expect(r.brief!.coverage.firstRun).toBe(true);
    expect(r.brief!.themes[0].videos[0].link).toMatch(/^https:\/\/www\.youtube\.com\/watch\?v=/);
  });

  it("publishes a thin week, without padding, when only 2 themes pass", async () => {
    const notion = { name: "Notion tips", slug: "notion", video_ids: ["solo1", "solo2", "solo3"], reason: "x" };
    const r = await run([goodThemes[0], goodThemes[1], notion]);
    expect(r.outcome).toBe("thin");
    expect(r.brief!.themes).toHaveLength(2);
    expect(r.brief!.thinWeekNote).toContain("Thin week");
    expect(r.calls).toBe(3); // cluster, cluster retry, write
  });

  it("fails with no brief when no theme passes", async () => {
    const notion = { name: "Notion tips", slug: "notion", video_ids: ["solo1", "solo2", "solo3"], reason: "x" };
    const r = await run([notion, notion, notion]);
    expect(r.outcome).toBe("failed");
    expect(r.brief).toBeNull();
    expect(r.failure).toContain("failed the Theme Gate");
  });
});
