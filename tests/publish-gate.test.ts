import { describe, expect, it } from "vitest";
import type { GenerateFn } from "@/lib/gemini";
import { matchNews } from "@/lib/news-match";
import {
  checkSummary,
  checkWrittenTheme,
  decideOutcome,
  extractNumberTokens,
  runPublishGate,
  WRITTEN_FAILED_NOTE,
} from "@/lib/publish-gate";
import { NO_NEWS, type ThemeEvidence, type WriteOutput, type WrittenTheme } from "@/lib/write";

const evidence: ThemeEvidence = {
  slug: "vivo-v80",
  name: "vivo V80 Unboxing & Review",
  momentum: "established",
  confidence: "medium",
  status_note: "New this week",
  metrics: {
    video_count: 5,
    creator_count: 5,
    first_published: "2026-10-06",
    last_published: "2026-10-09",
    median_views_per_day: 122715,
    views_per_day_vs_same_age_videos: 6.35,
    median_engagement_percent: 2.42,
    videos_with_engagement: 5,
  },
  momentum_reasons: ["5 creators, median views per day 6.35x the typical video of the same age.", "No comparable history yet."],
  format_findings: ["Formats: review: 5 videos from 5 creators. Sample too small to compare."],
  videos: [
    {
      title: "vivo V80 Unboxing & Quick Review 144Hz",
      channel: "Trakin Tech",
      published: "2026-10-08",
      link: "https://www.youtube.com/watch?v=abc123",
      views_per_day: 304970,
    },
  ],
  news: [
    { index: 0, headline: "vivo V80 launched in India with Zeiss cameras", source: "Example Times", date: "2026-10-07", link: "https://news.example.com/v80" },
  ],
};

const good: WrittenTheme = {
  slug: "vivo-v80",
  momentum: "established",
  confidence: "medium",
  why_this_week: "5 creators covered the vivo V80 between 2026-10-06 and 2026-10-09.",
  youtube_evidence: "Median views per day were about 123k, 6.35x the typical video of the same age, with 2.4% engagement.",
  news_index: 0,
  outside_context: "The phone launched in India this week, which explains why creators are covering it now.",
  interpretation: "Interpretation: audiences want a camera-first mid-range phone.",
  filming_angle: "Test the V80 144Hz screen against a budget rival in Delhi street light.",
  uncertain: "Only 5 videos and no history, so we cannot tell if interest is changing.",
};

const errors = (w: Partial<WrittenTheme>) => checkWrittenTheme({ ...good, ...w }, evidence, ["2026-W41"]);

describe("number extraction", () => {
  it("reads plain, comma, suffix and word-multiplier numbers", () => {
    const values = extractNumberTokens("1,22,715 views, 123k, 6.35x, 2.4%, 1.2 lakh and 3 creators")
      .filter((t) => t.kind === "number")
      .map((t) => (t.kind === "number" ? t.value : 0));
    expect(values).toEqual([122715, 123000, 6.35, 2.4, 120000, 3]);
  });

  it("treats product codes as codes, not numbers", () => {
    expect(extractNumberTokens("vivo V80 and S26")).toEqual([
      { kind: "code", raw: "V80" },
      { kind: "code", raw: "S26" },
    ]);
  });
});

describe("Publish Gate checks", () => {
  it("passes text that only uses evidence numbers, with rounding", () => {
    expect(errors({})).toEqual([]);
  });

  it("fails an invented number", () => {
    expect(errors({ youtube_evidence: "Median views per day were 250k." })).toContain(
      `theme 'vivo-v80' youtube_evidence: the number "250k" is not in the evidence`,
    );
  });

  it("checks dates as whole dates", () => {
    expect(errors({ why_this_week: "Coverage started on 2026-10-06." })).toEqual([]);
    expect(errors({ why_this_week: "Coverage started on 6 October 2026." })).toEqual([]);
    expect(errors({ why_this_week: "Coverage started on October 8." })).toEqual([]);
    expect(errors({ why_this_week: "Coverage started on 2026-10-03." })).toContain(
      "theme 'vivo-v80' why_this_week: the date 2026-10-03 is not in the evidence",
    );
    expect(errors({ why_this_week: "Coverage started on 3 October." })).toContain(
      "theme 'vivo-v80' why_this_week: the date 10-03 is not in the evidence",
    );
  });

  it("does not let parts of a date excuse a stray number", () => {
    // 2026-10-09 is in the evidence, but that does not make "9" a measured number.
    expect(errors({ why_this_week: "9 creators covered it." })).toContain(
      `theme 'vivo-v80' why_this_week: the number "9" is not in the evidence`,
    );
  });

  it("fails a wrong count", () => {
    expect(errors({ why_this_week: "12 creators covered it." }).length).toBeGreaterThan(0);
  });

  it("fails a product code that is not in the evidence", () => {
    expect(errors({ filming_angle: "Compare it with the Galaxy S26." })).toContain(
      `theme 'vivo-v80' filming_angle: "S26" does not appear in the evidence`,
    );
  });

  it("fails an invented link", () => {
    const e = errors({ outside_context: "See https://fake.example.com/story for details." });
    expect(e.some((x) => x.includes("the link https://fake.example.com/story is not in the evidence"))).toBe(true);
  });

  it("fails an invented quoted headline", () => {
    const e = errors({ outside_context: 'A report said "vivo V80 sales cross one million units" this week.' });
    expect(e.some((x) => x.includes("is not a title or headline from the evidence"))).toBe(true);
  });

  it("accepts a real quoted headline", () => {
    expect(errors({ outside_context: 'News: "vivo V80 launched in India with Zeiss cameras".' })).toEqual([]);
  });

  it("fails a changed momentum label", () => {
    expect(errors({ momentum: "rising" })).toContain("theme 'vivo-v80': momentum changed from 'established' to 'rising'");
  });

  it("fails a changed confidence label", () => {
    expect(errors({ confidence: "high" })).toContain("theme 'vivo-v80': confidence changed from 'medium' to 'high'");
  });

  it("fails rising language when momentum is established", () => {
    const e = errors({ interpretation: "Interpretation: this topic is taking off." });
    expect(e.some((x) => x.includes("describes the topic as rising"))).toBe(true);
  });

  it("requires the exact no-news sentence when no news item is chosen", () => {
    expect(errors({ news_index: null, outside_context: NO_NEWS })).toEqual([]);
    expect(errors({ news_index: null, outside_context: "Nothing relevant." }).length).toBe(1);
  });

  it("fails a news index that does not exist", () => {
    expect(errors({ news_index: 4 })).toContain("theme 'vivo-v80': news_index 4 does not exist (1 news items were given)");
  });

  it("fails a missing theme", () => {
    expect(checkWrittenTheme(undefined, evidence)).toEqual(["theme 'vivo-v80': missing from the answer"]);
  });

  it("checks the summary and top opportunities", () => {
    const out: WriteOutput = {
      executive_summary: "Phones are booming: 47 brands launched.",
      top_opportunities: [{ slug: "nope", reason: "x" }],
      themes: [good],
    };
    const e = checkSummary(out, [evidence]);
    expect(e).toContain(`executive_summary: the number "47" is not in the evidence`);
    expect(e).toContain("executive_summary: describes something as rising, but no theme is rising");
    expect(e).toContain("top_opportunities: unknown theme 'nope'");
  });
});

function fakeWriter(answers: unknown[]) {
  const prompts: string[] = [];
  const generate: GenerateFn = async (req) => {
    prompts.push(req.prompt);
    const next = answers[prompts.length - 1];
    return { text: typeof next === "string" ? next : JSON.stringify(next), tokensIn: 10, tokensOut: 5 };
  };
  return { generate, prompts };
}
const run = (generate: GenerateFn) => runPublishGate({ generate, model: "gemini-test-flash", weekId: "2026-W41", evidence: [evidence] });
const answer = (w: Partial<WrittenTheme>, summary = "One theme passed: vivo V80, established with medium confidence.") => ({
  executive_summary: summary,
  top_opportunities: [{ slug: "vivo-v80", reason: "5 creators are covering it now." }],
  themes: [{ ...good, ...w }],
});

describe("runPublishGate", () => {
  it("makes one call when everything passes", async () => {
    const fake = fakeWriter([answer({})]);
    const r = await run(fake.generate);
    expect(fake.prompts).toHaveLength(1);
    expect(r.written.get("vivo-v80")).not.toBeNull();
    expect(r.summaryFromCode).toBe(false);
    expect(r.errors).toEqual([]);
  });

  it("retries once with the errors and uses the fixed answer", async () => {
    const fake = fakeWriter([answer({ youtube_evidence: "About 999k views a day." }), answer({})]);
    const r = await run(fake.generate);
    expect(fake.prompts).toHaveLength(2);
    expect(fake.prompts[1]).toContain(`the number "999k" is not in the evidence`);
    expect(r.written.get("vivo-v80")).not.toBeNull();
  });

  it("falls back to evidence only after a second failure, never a third call", async () => {
    const bad = answer({ momentum: "rising" }, "47 brands launched phones.");
    const fake = fakeWriter([bad, bad, answer({})]);
    const r = await run(fake.generate);
    expect(fake.prompts).toHaveLength(2);
    expect(r.written.get("vivo-v80")).toBeNull();
    expect(r.summaryFromCode).toBe(true);
    expect(r.executiveSummary).toBe("This week 1 theme passed the checks: vivo V80 Unboxing & Review (established, medium confidence).");
    expect(r.errors.length).toBeGreaterThan(0);
    expect(WRITTEN_FAILED_NOTE).toBe("Written summary failed checks.");
  });

  it("replaces em dashes in published text", async () => {
    const fake = fakeWriter([answer({ interpretation: "Interpretation: camera first â€” not gaming." })]);
    const r = await run(fake.generate);
    expect(r.written.get("vivo-v80")!.interpretation).toBe("Interpretation: camera first, not gaming.");
  });
});

describe("decideOutcome", () => {
  it("maps theme counts to the run status", () => {
    expect(decideOutcome(false, 0)).toBe("failed");
    expect(decideOutcome(false, 1)).toBe("thin");
    expect(decideOutcome(false, 2)).toBe("thin");
    expect(decideOutcome(false, 3)).toBe("succeeded");
    expect(decideOutcome(false, 5)).toBe("succeeded");
    expect(decideOutcome(true, 4)).toBe("failed");
  });
});

describe("matchNews", () => {
  const item = (title: string, link: string, publishedAt = "2026-10-08T00:00:00.000Z") => ({ title, link, source: "S", publishedAt });

  it("keeps up to 3 headlines that share a keyword, best overlap first", () => {
    const pool = [
      item("Cricket score update", "l1"),
      item("vivo V80 price leaked", "l2"),
      item("vivo V80 review: vivo camera wins", "l3"),
      item("vivo V80 price leaked", "l2"),
      item("vivo X300 launch", "l4"),
      item("New vivo tablet", "l5"),
    ];
    const got = matchNews("vivo V80 Unboxing & Review", pool).map((n) => n.link);
    expect(got).toHaveLength(3);
    expect(got[0]).toBe("l2");
    expect(got).not.toContain("l1");
  });

  it("returns nothing when no headline matches", () => {
    expect(matchNews("Claude Code", [item("Cricket score update", "l1")])).toEqual([]);
  });
});
