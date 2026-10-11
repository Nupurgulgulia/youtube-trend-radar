import { describe, expect, it } from "vitest";
import type { GenerateFn } from "@/lib/gemini";
import { checkThemes, matchPastTheme, runThemeGate, type StoredPastTheme } from "@/lib/theme-gate";
import { defaultSettings } from "./fixtures/settings";
import { goodThemes, observedAt, videos, videosById } from "./fixtures/themes";

const errorsFor = (themes: typeof goodThemes) => checkThemes(themes, videosById).map((c) => c.errors);

describe("Theme Gate checks", () => {
  it("passes three clear, separate themes", () => {
    expect(errorsFor(goodThemes)).toEqual([[], [], []]);
  });

  it("fails an invented video ID", () => {
    const [errors] = errorsFor([{ ...goodThemes[0], video_ids: ["cur1", "cur2", "cur3", "FAKE123"] }]);
    expect(errors).toContain("theme 'cursor-ai-coding': video FAKE123 not in dataset");
  });

  it("fails a single-creator theme", () => {
    const [errors] = errorsFor([{ name: "Notion tips", slug: "notion", video_ids: ["solo1", "solo2", "solo3"], reason: "x" }]);
    expect(errors).toContain("theme 'notion': only 1 distinct creator (need 2)");
  });

  it("fails a theme with too few videos", () => {
    const [errors] = errorsFor([{ ...goodThemes[1], video_ids: ["pix1", "pix2"] }]);
    expect(errors.some((e) => e.includes("only 2 valid videos"))).toBe(true);
  });

  it("fails an overlapping video in the later theme only", () => {
    const overlapping = [goodThemes[0], { ...goodThemes[1], video_ids: ["pix1", "pix2", "pix3", "cur1"] }];
    const [first, second] = errorsFor(overlapping);
    expect(first).toEqual([]);
    expect(second).toContain("theme 'pixel-10': video cur1 is already in theme 'cursor-ai-coding'");
  });

  it("fails an incoherent theme", () => {
    const [errors] = errorsFor([
      { name: "Lifestyle picks", slug: "lifestyle", video_ids: ["rand1", "rand2", "rand3"], reason: "x" },
    ]);
    expect(errors.some((e) => e.includes("share a keyword"))).toBe(true);
  });

  it("normalises the slug in code", () => {
    const [check] = checkThemes([{ ...goodThemes[0], slug: "Cursor AI Coding!!" }], videosById);
    expect(check.theme.slug).toBe("cursor-ai-coding");
  });
});

describe("past theme matching", () => {
  const past: StoredPastTheme[] = [
    { weekId: "2026-W39", slug: "cursor-ide", name: "Cursor IDE", recurringFromWeek: null, creatorCount: 3, recentUploadCount: 3 },
    { weekId: "2026-W40", slug: "cursor-ide", name: "Cursor IDE", recurringFromWeek: "2026-W39", creatorCount: 4, recentUploadCount: 5 },
    { weekId: "2026-W40", slug: "pixel-10", name: "Pixel 10", recurringFromWeek: null, creatorCount: 2, recentUploadCount: 2 },
  ];

  it("matches by slug, most recent week first", () => {
    expect(matchPastTheme("Pixel 10 launch", "pixel-10", past)?.weekId).toBe("2026-W40");
  });

  it("matches by keyword overlap when slugs differ", () => {
    const m = matchPastTheme("Cursor AI coding", "cursor-ai-coding", past);
    expect(m?.weekId).toBe("2026-W40");
    expect(m?.recurringFromWeek).toBe("2026-W39");
  });

  it("returns null for a new topic", () => {
    expect(matchPastTheme("Big Billion Days deals", "big-billion-days", past)).toBeNull();
  });
});

// Fake Gemini: returns the queued answers in order and records each prompt.
function fakeGemini(answers: unknown[]) {
  const prompts: string[] = [];
  const generate: GenerateFn = async (req) => {
    prompts.push(req.prompt);
    const next = answers[prompts.length - 1];
    return { text: typeof next === "string" ? next : JSON.stringify(next), tokensIn: 100, tokensOut: 50 };
  };
  return { generate, prompts };
}

const gate = (generate: GenerateFn, pastThemes: StoredPastTheme[] = []) =>
  runThemeGate({
    generate,
    model: "gemini-test-flash",
    settings: defaultSettings,
    candidates: videos,
    allVideos: videos,
    histories: new Map(),
    pastThemes,
    observedAt,
  });

describe("runThemeGate", () => {
  it("makes one call when everything passes, and computes metrics in code", async () => {
    const fake = fakeGemini([{ themes: goodThemes }]);
    const r = await gate(fake.generate);
    expect(fake.prompts).toHaveLength(1);
    expect(r.themes).toHaveLength(3);
    expect(r.themes[0].metrics.videoCount).toBe(4);
    expect(r.themes[0].metrics.creatorCount).toBe(4);
    expect(r.themes[0].links[0]).toBe("https://www.youtube.com/watch?v=cur1");
    expect(["established", "insufficient_evidence"]).toContain(r.themes[0].metrics.momentum);
    expect(r.themes.every((t) => t.isNew)).toBe(true);
    expect(r.logs).toEqual([expect.objectContaining({ task: "cluster", attempt: 1, ok: true })]);
  });

  it("retries once with the specific errors, then drops what still fails", async () => {
    const bad = [...goodThemes.slice(0, 2), { name: "Notion tips", slug: "notion", video_ids: ["solo1", "solo2", "solo3"], reason: "x" }];
    const fake = fakeGemini([{ themes: bad }, { themes: bad }, { themes: goodThemes }]);
    const r = await gate(fake.generate);
    expect(fake.prompts).toHaveLength(2); // never a third cluster call
    expect(fake.prompts[1]).toContain("theme 'notion': only 1 distinct creator (need 2)");
    expect(r.themes.map((t) => t.slug)).toEqual(["cursor-ai-coding", "pixel-10"]);
    expect(r.dropped).toEqual([{ name: "Notion tips", errors: ["theme 'notion': only 1 distinct creator (need 2)"] }]);
  });

  it("uses the retry answer when it fixes the problem", async () => {
    const withFake = [{ ...goodThemes[0], video_ids: ["cur1", "cur2", "cur3", "FAKE"] }, ...goodThemes.slice(1)];
    const fake = fakeGemini([{ themes: withFake }, { themes: goodThemes }]);
    const r = await gate(fake.generate);
    expect(r.themes).toHaveLength(3);
    expect(r.dropped).toEqual([]);
  });

  it("retries after malformed JSON", async () => {
    const fake = fakeGemini(["{not json", { themes: goodThemes }]);
    const r = await gate(fake.generate);
    expect(fake.prompts[1]).toContain("Response was not valid JSON");
    expect(r.themes).toHaveLength(3);
    expect(r.logs.map((l) => l.ok)).toEqual([false, true]);
  });

  it("keeps first-attempt passes if the retry is unusable", async () => {
    const bad = [...goodThemes.slice(0, 2), { name: "Notion tips", slug: "notion", video_ids: ["solo1", "solo2", "solo3"], reason: "x" }];
    const fake = fakeGemini([{ themes: bad }, "garbage"]);
    const r = await gate(fake.generate);
    expect(r.themes.map((t) => t.slug)).toEqual(["cursor-ai-coding", "pixel-10"]);
  });

  it("reports a failure when nothing survives", async () => {
    const fake = fakeGemini(["nope", "still nope"]);
    const r = await gate(fake.generate);
    expect(r.themes).toEqual([]);
    expect(r.failure).toContain("Gemini did not return usable themes");
  });

  it("labels a recurring theme and passes its past numbers to momentum", async () => {
    const fake = fakeGemini([{ themes: goodThemes }]);
    const past: StoredPastTheme[] = [
      { weekId: "2026-W40", slug: "pixel-10", name: "Pixel 10", recurringFromWeek: null, creatorCount: 1, recentUploadCount: 1 },
    ];
    const r = await gate(fake.generate, past);
    const pixel = r.themes.find((t) => t.slug === "pixel-10")!;
    expect(pixel.isNew).toBe(false);
    expect(pixel.recurringFromWeek).toBe("2026-W40");
  });
});
