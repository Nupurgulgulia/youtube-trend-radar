import { MAX_IDS_PER_REQUEST } from "./config/quota";
import type { NewsItem } from "./news";
import { planQuota, type QuotaBudget, type QuotaPlan } from "./quota";
import type { Settings } from "./types";
import type { QuotaUsage, YouTubeClient, YouTubeVideo } from "./youtube";

// Collector (map step 6). Plans calls against the quota budget, fetches each video
// only once, flags videos that disappeared, and records every source as ok, partial
// or failed. It does not touch the database: store.ts writes the result.

// Subscriber counts are optional and only used for small/big channel flags.
export const INCLUDE_CHANNEL_LOOKUP = true;
const SEARCH_WINDOW_DAYS = 7;

export type SourceStatus = "ok" | "partial" | "failed";
export type SourceEntry = { source: string; status: "ok" | "failed"; reason: string | null };
export type SourceReport = {
  youtube: { status: SourceStatus; reason: string | null };
  news: { status: SourceStatus; reason: string | null };
  details: SourceEntry[];
};

export type CollectedVideo = YouTubeVideo & {
  foundBy: string[]; // "trending:28", "search:AI tools", "tracked"
  channelSubscribers: number | null;
};

export type Snapshot = {
  videoId: string;
  observedAt: string;
  observedOn: string; // UTC date, one snapshot per video per day
  views: number;
  likes: number | null;
  comments: number | null;
  channelSubscribers: number | null;
};

export type CollectionResult = {
  observedAt: string;
  videos: CollectedVideo[];
  snapshots: Snapshot[];
  unavailableIds: string[];
  news: { query: string; items: NewsItem[] }[];
  sourceReport: SourceReport;
  plan: QuotaPlan;
  quotaUsed: QuotaUsage;
  youtubeFailed: boolean;
};

export type CollectorDeps = {
  youtube: YouTubeClient;
  fetchNews: (query: string) => Promise<NewsItem[]>;
  now: Date;
  budget: QuotaBudget;
  trackedIds: string[];
};

const chunk = <T,>(xs: T[], size: number) =>
  Array.from({ length: Math.ceil(xs.length / size) }, (_, i) => xs.slice(i * size, i * size + size));

const reasonOf = (e: unknown) => (e instanceof Error ? e.message : "Unknown error");

function summarise(entries: SourceEntry[], prefix: string, anyData: boolean) {
  const mine = entries.filter((e) => e.source.startsWith(prefix));
  const failed = mine.filter((e) => e.status === "failed");
  if (mine.length === 0) return { status: "failed" as const, reason: "No requests were made" };
  if (failed.length === 0) return { status: "ok" as const, reason: null };
  const reason = `${failed.length} of ${mine.length} requests failed: ${failed[0].reason}`;
  return { status: anyData && failed.length < mine.length ? ("partial" as const) : ("failed" as const), reason };
}

export async function collect(settings: Settings, deps: CollectorDeps): Promise<CollectionResult> {
  const { youtube } = deps;
  const observedAt = deps.now.toISOString();
  const entries: SourceEntry[] = [];
  const videos = new Map<string, CollectedVideo>();
  const foundBy = new Map<string, Set<string>>();
  const note = (id: string, tag: string) => {
    if (!foundBy.has(id)) foundBy.set(id, new Set());
    foundBy.get(id)!.add(tag);
  };
  const ok = (source: string) => entries.push({ source, status: "ok", reason: null });
  const fail = (source: string, e: unknown) => entries.push({ source, status: "failed", reason: reasonOf(e) });
  const addVideo = (v: YouTubeVideo) => {
    if (!videos.has(v.videoId)) videos.set(v.videoId, { ...v, foundBy: [], channelSubscribers: null });
  };

  // 1. Budget first.
  const plan = planQuota(settings, deps.budget, {
    trackedVideoCount: deps.trackedIds.length,
    includeChannels: INCLUDE_CHANNEL_LOOKUP,
  });

  const unavailableIds: string[] = [];

  if (plan.fits) {
    // 2. Trending: one call per category, or one region-wide call.
    const categories = settings.categoryIds.length > 0 ? settings.categoryIds : [null];
    for (const cat of categories) {
      const source = `youtube:trending:${cat ?? "all"}`;
      try {
        for (const v of await youtube.mostPopular(settings.regionCode, cat)) {
          addVideo(v);
          note(v.videoId, `trending:${cat ?? "all"}`);
        }
        ok(source);
      } catch (e) {
        fail(source, e);
      }
    }

    // 3. Search: one call per keyword that fits the budget.
    const publishedAfter = new Date(deps.now.getTime() - SEARCH_WINDOW_DAYS * 86_400_000);
    const needDetails = new Set<string>();
    for (const keyword of plan.keywordsUsed) {
      const source = `youtube:search:${keyword}`;
      try {
        const ids = await youtube.search(keyword, {
          regionCode: settings.regionCode,
          relevanceLanguage: settings.relevanceLanguage,
          publishedAfter,
        });
        for (const id of ids) {
          note(id, `search:${keyword}`);
          if (!videos.has(id)) needDetails.add(id);
        }
        ok(source);
      } catch (e) {
        fail(source, e);
      }
    }

    // 4. Tracked videos from earlier weeks, so momentum can compare snapshots.
    for (const id of deps.trackedIds) {
      note(id, "tracked");
      if (!videos.has(id)) needDetails.add(id);
    }

    // 5. Details for every new ID, each fetched once, in batches of 50.
    for (const [i, batch] of chunk([...needDetails], MAX_IDS_PER_REQUEST).entries()) {
      const source = `youtube:videos:batch-${i + 1}`;
      try {
        const returned = await youtube.videosByIds(batch);
        returned.forEach(addVideo);
        const got = new Set(returned.map((v) => v.videoId));
        unavailableIds.push(...batch.filter((id) => !got.has(id)));
        ok(source);
      } catch (e) {
        fail(source, e);
      }
    }

    // 6. Optional subscriber counts. A failure here never fails the run.
    if (INCLUDE_CHANNEL_LOOKUP && videos.size > 0) {
      const channelIds = [...new Set([...videos.values()].map((v) => v.channelId))];
      const subs = new Map<string, number | null>();
      for (const [i, batch] of chunk(channelIds, MAX_IDS_PER_REQUEST).entries()) {
        const source = `youtube:channels:batch-${i + 1}`;
        try {
          for (const [id, n] of await youtube.channelSubscribers(batch)) subs.set(id, n);
          ok(source);
        } catch (e) {
          fail(source, e);
        }
      }
      for (const v of videos.values()) v.channelSubscribers = subs.get(v.channelId) ?? null;
    }
  } else {
    entries.push({ source: "youtube:plan", status: "failed", reason: plan.problem });
  }

  for (const v of videos.values()) v.foundBy = [...(foundBy.get(v.videoId) ?? [])].sort();

  // 7. News per keyword. Context only, never fatal.
  const news: CollectionResult["news"] = [];
  for (const query of plan.keywordsUsed) {
    const source = `news:${query}`;
    try {
      news.push({ query, items: await deps.fetchNews(query) });
      ok(source);
    } catch (e) {
      fail(source, e);
    }
  }

  // Snapshots: only videos with a view count. Missing likes or comments stay null.
  const observedOn = observedAt.slice(0, 10);
  const collected = [...videos.values()];
  const snapshots: Snapshot[] = collected
    .filter((v) => v.views !== null)
    .map((v) => ({
      videoId: v.videoId,
      observedAt,
      observedOn,
      views: v.views as number,
      likes: v.likes,
      comments: v.comments,
      channelSubscribers: v.channelSubscribers,
    }));

  const youtubeFailed = collected.length === 0;
  const youtubeSummary = summarise(entries, "youtube:", !youtubeFailed);
  const newsSummary = summarise(entries, "news:", news.some((n) => n.items.length > 0));

  return {
    observedAt,
    videos: collected,
    snapshots,
    unavailableIds,
    news,
    sourceReport: {
      youtube: youtubeFailed
        ? { status: "failed", reason: youtubeSummary.reason ?? "No videos were collected" }
        : youtubeSummary,
      news: newsSummary,
      details: entries,
    },
    plan,
    quotaUsed: { ...youtube.usage },
    youtubeFailed,
  };
}
