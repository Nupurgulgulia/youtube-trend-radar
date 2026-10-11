import { describe, expect, it } from "vitest";
import { buildClusterPrompt, selectCandidates } from "@/lib/cluster";
import { scoreVideos, type VideoInput } from "@/lib/scorer";
import { defaultSettings } from "./fixtures/settings";

const observedAt = "2026-10-11T00:30:00Z";
const v = (videoId: string, views: number, foundBy: string[]): VideoInput => ({
  videoId,
  channelId: `c-${videoId}`,
  channelTitle: `C ${videoId}`,
  title: `Title ${videoId}`,
  publishedAt: "2026-10-08T00:30:00Z",
  durationSec: 600,
  tags: [],
  views,
  likes: null,
  comments: null,
  foundBy,
});

describe("selectCandidates", () => {
  // 6 viral trending videos and 3 modest "AI tools" search results.
  const videos = scoreVideos(
    [
      ...[1, 2, 3, 4, 5, 6].map((i) => v(`t${i}`, 1_000_000 * i, ["trending:28"])),
      v("a1", 3000, ["search:AI tools"]),
      v("a2", 2000, ["search:AI tools"]),
      v("a3", 1000, ["search:AI tools"]),
    ],
    observedAt,
  );

  it("gives each source a turn instead of taking only the most viral", () => {
    const ids = selectCandidates(videos, 6).map((x) => x.videoId);
    expect(ids).toEqual(["a1", "t6", "a2", "t5", "a3", "t4"]);
  });

  it("lets other sources fill the slots once one runs out", () => {
    const ids = selectCandidates(videos, 8).map((x) => x.videoId);
    expect(ids.filter((id) => id.startsWith("a"))).toHaveLength(3);
    expect(ids).toHaveLength(8);
  });

  it("picks a video found by two sources only once", () => {
    const both = scoreVideos([v("x", 5000, ["search:AI tools", "trending:28"]), v("y", 100, ["trending:28"])], observedAt);
    expect(selectCandidates(both, 10).map((c) => c.videoId)).toEqual(["x", "y"]);
  });

  it("treats videos without a recorded source as one group", () => {
    const old = scoreVideos([v("o1", 10, []), v("o2", 20, [])], observedAt);
    expect(selectCandidates(old, 10).map((c) => c.videoId)).toEqual(["o2", "o1"]);
  });
});

describe("buildClusterPrompt", () => {
  it("never includes view counts or other metrics", () => {
    const [video] = scoreVideos([v("abc", 123_456, ["trending:28"])], observedAt);
    const prompt = buildClusterPrompt([video], defaultSettings);
    expect(prompt).toContain("abc");
    expect(prompt).not.toContain("123456");
    expect(prompt).not.toContain("123,456");
  });

  it("adds the specific errors on a retry", () => {
    const prompt = buildClusterPrompt([], defaultSettings, ["theme 'x': video Q not in dataset"]);
    expect(prompt).toContain("- theme 'x': video Q not in dataset");
  });
});
