import { describe, expect, it } from "vitest";
import { classifyFormat } from "@/lib/config/formats";
import { ageBand, ageDays, engagementRate, lengthBucket, scoreVideos, type VideoInput } from "@/lib/scorer";

const observedAt = "2026-10-11T00:30:00Z";
const video = (o: Partial<VideoInput> & { videoId: string }): VideoInput => ({
  channelId: "c1",
  channelTitle: "C1",
  title: "Some video",
  publishedAt: "2026-10-09T00:30:00Z",
  durationSec: 300,
  tags: [],
  views: 10_000,
  likes: 500,
  comments: 100,
  ...o,
});

describe("per-video metrics", () => {
  it("computes age with a half-day floor", () => {
    expect(ageDays("2026-10-09T00:30:00Z", observedAt)).toBe(2);
    expect(ageDays("2026-10-11T00:00:00Z", observedAt)).toBe(0.5);
  });

  it("computes views per day from views and age", () => {
    const [v] = scoreVideos([video({ videoId: "a", views: 10_000 })], observedAt);
    expect(v.viewsPerDay).toBe(5000);
  });

  it("puts ages into the right band", () => {
    expect(ageBand(0.5)).toBe("0-2 days");
    expect(ageBand(2.9)).toBe("0-2 days");
    expect(ageBand(3)).toBe("3-7 days");
    expect(ageBand(7.9)).toBe("3-7 days");
    expect(ageBand(8)).toBe("8-14 days");
    expect(ageBand(15)).toBe("15+ days");
  });

  it("puts durations into the right length bucket", () => {
    expect(lengthBucket(180)).toBe("short");
    expect(lengthBucket(181)).toBe("mid");
    expect(lengthBucket(600)).toBe("mid");
    expect(lengthBucket(601)).toBe("long");
    expect(lengthBucket(1200)).toBe("long");
    expect(lengthBucket(1201)).toBe("deep");
    expect(lengthBucket(null)).toBe("unknown");
  });

  it("returns null engagement when anything is missing or views are too low", () => {
    expect(engagementRate(10_000, 500, 100)).toBe(0.06);
    expect(engagementRate(10_000, null, 100)).toBeNull();
    expect(engagementRate(10_000, 500, null)).toBeNull();
    expect(engagementRate(null, 500, 100)).toBeNull();
    expect(engagementRate(999, 50, 10)).toBeNull();
  });

  it("keeps views per day null when views are missing", () => {
    const [v] = scoreVideos([video({ videoId: "a", views: null })], observedAt);
    expect(v.viewsPerDay).toBeNull();
    expect(v.bandIndex).toBeNull();
  });

  it("compares views per day only within the same age band", () => {
    const scored = scoreVideos(
      [
        // Young videos: 0-2 days. Median views per day = 5000.
        video({ videoId: "y1", publishedAt: "2026-10-10T00:30:00Z", views: 4000 }),
        video({ videoId: "y2", publishedAt: "2026-10-10T00:30:00Z", views: 5000 }),
        video({ videoId: "y3", publishedAt: "2026-10-10T00:30:00Z", views: 6000 }),
        // Older videos: 8-14 days. Median views per day = 100.
        video({ videoId: "o1", publishedAt: "2026-10-01T00:30:00Z", views: 1000 }),
        video({ videoId: "o2", publishedAt: "2026-10-01T00:30:00Z", views: 2000 }),
      ],
      observedAt,
    );
    const byId = Object.fromEntries(scored.map((v) => [v.videoId, v]));
    expect(byId.y2.bandIndex).toBe(1);
    expect(byId.o2.bandIndex).toBeCloseTo(200 / 150);
    // The old video with 200 views/day beats its band; the young one with 4000 does not.
    expect(byId.o2.bandIndex!).toBeGreaterThan(byId.y1.bandIndex!);
  });
});

describe("format rules", () => {
  it.each([
    ["ChatGPT vs Gemini: which is better?", "comparison"],
    ["Pixel 10 review after 30 days", "review"],
    ["How to use Cursor IDE for beginners", "tutorial"],
    ["Top 10 AI tools for students", "list"],
    ["7 apps you need on your phone", "list"],
    ["OpenAI just launched a new model", "news_reaction"],
    ["What is an AI agent?", "explainer"],
    ["Daily vlog 42", "other"],
    // Real titles from the first live collection (2026-10-11):
    ["Which AI is smartest?", "comparison"],
    ["Viral LED Light Setup Gone Right", "other"],
  ])("classifies %j as %s", (title, format) => {
    expect(classifyFormat(title, [])).toBe(format);
  });

  it("checks the title before the tags", () => {
    expect(classifyFormat("Galaxy S26 review", ["tutorial"])).toBe("review");
  });

  it("falls back to tags when the title matches nothing", () => {
    expect(classifyFormat("Galaxy S26 ka sach", ["phone review", "hindi"])).toBe("review");
  });
});
