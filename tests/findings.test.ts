import { describe, expect, it } from "vitest";
import { findings } from "@/lib/findings";
import { scoreVideos, type VideoInput } from "@/lib/scorer";
import { themeMetrics } from "@/lib/theme-metrics";

const observedAt = "2026-10-11T00:30:00Z";
let n = 0;
const video = (title: string, channelId: string, views: number, durationSec = 300): VideoInput => ({
  videoId: `v${++n}`,
  channelId,
  channelTitle: channelId,
  title,
  publishedAt: "2026-10-09T00:30:00Z",
  durationSec,
  tags: [],
  views,
  likes: Math.round(views * 0.05),
  comments: Math.round(views * 0.01),
});

describe("format and length findings", () => {
  it("says the sample is too small when a group has fewer than 5 videos", () => {
    const vs = scoreVideos(
      [
        ...["a", "b", "c", "d"].map((c) => video("Phone review", c, 10_000)),
        ...["a", "b", "c", "d", "e"].map((c) => video("How to set up", c, 5_000)),
      ],
      observedAt,
    );
    const f = findings(vs);
    expect(f.formatComparison).toEqual({ status: "too_small", message: "Sample too small to compare" });
    expect(f.formats.find((g) => g.group === "review")).toMatchObject({ videos: 4, creators: 4, comparable: false });
  });

  it("says the sample is too small when 5 videos come from only 2 creators", () => {
    const vs = scoreVideos(
      [
        ...["a", "a", "a", "b", "b"].map((c) => video("Phone review", c, 10_000)),
        ...["a", "b", "c", "d", "e"].map((c) => video("How to set up", c, 5_000)),
      ],
      observedAt,
    );
    expect(findings(vs).formatComparison.status).toBe("too_small");
  });

  it("ranks groups when both sides are big enough, with sample sizes", () => {
    const vs = scoreVideos(
      [
        ...["a", "b", "c", "d", "e"].map((c) => video("Phone review", c, 10_000)),
        ...["a", "b", "c", "d", "e"].map((c) => video("How to set up", c, 5_000)),
      ],
      observedAt,
    );
    const f = findings(vs);
    expect(f.formatComparison).toEqual({
      status: "ranked",
      ranking: [
        { group: "review", medianBandIndex: 1.33 },
        { group: "tutorial", medianBandIndex: 0.67 },
      ],
    });
    expect(f.formats.find((g) => g.group === "review")).toMatchObject({
      videos: 5,
      creators: 5,
      medianViewsPerDay: 5000,
      engagementSample: 5,
    });
  });
});

describe("formats within a length bucket", () => {
  it("compares formats separately for shorts and long videos", () => {
    const vs = scoreVideos(
      [
        ...["a", "b", "c", "d", "e"].map((c) => video("Phone review", c, 50_000, 60)),
        ...["a", "b", "c", "d", "e"].map((c) => video("How to edit", c, 10_000, 60)),
        ...["a", "b", "c"].map((c) => video("Phone review", c, 5_000, 900)),
      ],
      observedAt,
    );
    const f = findings(vs);
    const short = f.formatsByLength.find((g) => g.length === "short")!;
    const long = f.formatsByLength.find((g) => g.length === "long")!;
    expect(short.comparison.status).toBe("ranked");
    expect(long.comparison).toEqual({ status: "too_small", message: "Sample too small to compare" });
    expect(long.formats).toEqual([expect.objectContaining({ group: "review", videos: 3, creators: 3 })]);
  });
});

describe("themeMetrics on a first run", () => {
  it("measures the theme and never gives rising, fading or high confidence", () => {
    const vs = scoreVideos(
      ["a", "b", "c", "d"].map((c) => video("Cursor IDE review", c, 20_000)),
      observedAt,
    );
    const m = themeMetrics(vs, new Map(), null, observedAt);
    expect(m.videoCount).toBe(4);
    expect(m.creatorCount).toBe(4);
    expect(["established", "insufficient_evidence"]).toContain(m.momentum);
    expect(m.confidence).not.toBe("high");
    expect(m.trackedVideos).toBe(0);
    expect(m.recentUploadCount).toBe(4);
  });
});
