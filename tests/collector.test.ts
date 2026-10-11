import { describe, expect, it } from "vitest";
import { collect } from "@/lib/collector";
import { createYouTubeClient } from "@/lib/youtube";
import type { NewsItem } from "@/lib/news";
import { defaultSettings } from "./fixtures/settings";
import { apiError, fakeFetch, json, noSleep, videoItem } from "./fixtures/youtube";

const budget = { dailyQuota: 10_000, searchDailyLimit: 100, safetyMargin: 0.5 };
const now = new Date("2026-10-11T00:30:00Z");
const settings = { ...defaultSettings, keywords: ["AI tools", "ChatGPT"] };
const someNews: NewsItem[] = [
  { title: "Headline", source: "Example News", link: "https://example.com/a", publishedAt: "2026-10-10T00:00:00.000Z" },
];

function setup(
  handlers: Parameters<typeof fakeFetch>[0],
  extra: { trackedIds?: string[]; fetchNews?: (q: string) => Promise<NewsItem[]> } = {},
) {
  const fake = fakeFetch(handlers);
  const youtube = createYouTubeClient({ apiKey: "k", fetchFn: fake.fn, sleep: noSleep });
  const run = () =>
    collect(settings, {
      youtube,
      fetchNews: extra.fetchNews ?? (async () => someNews),
      now,
      budget,
      trackedIds: extra.trackedIds ?? [],
    });
  return { fake, youtube, run };
}

// Returns full items for the requested IDs, except any listed as gone.
const videosById = (gone: string[] = []) => (url: URL) => {
  if (url.searchParams.get("chart") === "mostPopular") {
    return json({ items: [videoItem({ id: "t1", views: "5000" }), videoItem({ id: "t2", channel: "chan-b", views: "900" })] });
  }
  const ids = (url.searchParams.get("id") ?? "").split(",").filter((id) => !gone.includes(id));
  return json({ items: ids.map((id) => videoItem({ id, channel: `chan-${id}`, views: "100" })) });
};
const channels = () => json({ items: [] });

describe("collector", () => {
  it("fetches an ID found by trending and two searches only once", async () => {
    const { fake, run } = setup({
      videos: videosById(),
      channels,
      search: (url) =>
        json({
          items:
            url.searchParams.get("q") === "AI tools"
              ? [{ id: { videoId: "t1" } }, { id: { videoId: "s1" } }]
              : [{ id: { videoId: "s1" } }, { id: { videoId: "s2" } }],
        }),
    });
    const result = await run();

    const detailCalls = fake.calls.filter((u) => u.pathname.endsWith("/videos") && u.searchParams.has("id"));
    expect(detailCalls).toHaveLength(1);
    expect(detailCalls[0].searchParams.get("id")!.split(",").sort()).toEqual(["s1", "s2"]); // t1 came with trending
    expect(result.videos.map((v) => v.videoId).sort()).toEqual(["s1", "s2", "t1", "t2"]);
    expect(result.videos.find((v) => v.videoId === "s1")!.foundBy).toEqual(["search:AI tools", "search:ChatGPT"]);
    expect(result.snapshots).toHaveLength(4);
    expect(result.sourceReport.youtube.status).toBe("ok");
  });

  it("flags a tracked video that no longer comes back", async () => {
    const { run } = setup(
      { videos: videosById(["gone1"]), channels, search: () => json({ items: [] }) },
      { trackedIds: ["kept1", "gone1"] },
    );
    const result = await run();
    expect(result.unavailableIds).toEqual(["gone1"]);
    expect(result.videos.some((v) => v.videoId === "kept1")).toBe(true);
  });

  it("records a partial failure when one search fails", async () => {
    const { run } = setup({
      videos: videosById(),
      channels,
      search: (url) =>
        url.searchParams.get("q") === "ChatGPT" ? apiError(400, "invalidSearchFilter") : json({ items: [] }),
    });
    const result = await run();
    expect(result.youtubeFailed).toBe(false);
    expect(result.sourceReport.youtube.status).toBe("partial");
    const failed = result.sourceReport.details.find((d) => d.source === "youtube:search:ChatGPT")!;
    expect(failed.status).toBe("failed");
    expect(failed.reason).toContain("invalidSearchFilter");
  });

  it("stops all YouTube calls after a quota error and never retries it", async () => {
    const { fake, run } = setup({
      videos: videosById(),
      channels,
      search: () => apiError(403, "quotaExceeded"),
    });
    const result = await run();

    const searchCalls = fake.calls.filter((u) => u.pathname.endsWith("/search"));
    expect(searchCalls).toHaveLength(1); // first search hit the quota; the second was never sent
    expect(fake.calls.some((u) => u.pathname.endsWith("/channels"))).toBe(false);
    const second = result.sourceReport.details.find((d) => d.source === "youtube:search:ChatGPT")!;
    expect(second.reason).toContain("quota was exceeded earlier");
    expect(result.videos).toHaveLength(2); // trending, collected before the quota ran out
  });

  it("keeps going when news fails", async () => {
    const { run } = setup(
      { videos: videosById(), channels, search: () => json({ items: [] }) },
      { fetchNews: async () => { throw new Error("Google News returned HTTP 503"); } },
    );
    const result = await run();
    expect(result.youtubeFailed).toBe(false);
    expect(result.sourceReport.news.status).toBe("failed");
    expect(result.sourceReport.youtube.status).toBe("ok");
  });

  it("marks YouTube as failed when nothing at all was collected", async () => {
    const { run } = setup({ videos: () => apiError(403, "forbidden"), search: () => apiError(403, "forbidden") });
    const result = await run();
    expect(result.youtubeFailed).toBe(true);
    expect(result.sourceReport.youtube.status).toBe("failed");
    expect(result.snapshots).toEqual([]);
  });

  it("skips low-priority keywords when over budget and makes no calls for them", async () => {
    const fake = fakeFetch({ videos: videosById(), channels, search: () => json({ items: [] }) });
    const youtube = createYouTubeClient({ apiKey: "k", fetchFn: fake.fn, sleep: noSleep });
    const tight = { ...budget, searchDailyLimit: 2 }; // 2 x 0.5 = 1 search allowed
    const result = await collect(settings, { youtube, fetchNews: async () => [], now, budget: tight, trackedIds: [] });
    expect(result.plan.keywordsUsed).toEqual(["AI tools"]);
    expect(result.plan.keywordsSkipped.map((s) => s.keyword)).toEqual(["ChatGPT"]);
    expect(fake.calls.filter((u) => u.searchParams.get("q") === "ChatGPT")).toHaveLength(0);
  });

  it("writes snapshots dated by UTC day with null likes kept null", async () => {
    const { run } = setup({
      videos: () => json({ items: [videoItem({ id: "x", views: "10", likes: undefined })] }),
      channels,
      search: () => json({ items: [] }),
    });
    const result = await run();
    expect(result.snapshots[0]).toMatchObject({ videoId: "x", observedOn: "2026-10-11", views: 10, likes: null });
  });
});
