import { z } from "zod";
import {
  COST_CHANNELS_LIST,
  COST_SEARCH_LIST,
  COST_VIDEO_CATEGORIES_LIST,
  COST_VIDEOS_LIST,
  MAX_IDS_PER_REQUEST,
  MAX_RESULTS_PER_PAGE,
} from "./config/quota";

// YouTube Data API v3 client (map step 3).
// - Counts quota for every attempt, because invalid requests cost quota too.
// - Retries transient errors (rate limits, 5xx, network) at most twice with backoff.
// - Never retries a quota error, and refuses every later call in the same run.
// - Validates every response with zod.
// - Error messages never include the request URL, because the URL carries the API key.

const API = "https://www.googleapis.com/youtube/v3";
export const MAX_RETRIES = 2;
const BACKOFF_MS = [500, 1500];

export class QuotaExceededError extends Error {
  constructor(message = "YouTube daily quota exceeded") {
    super(message);
    this.name = "QuotaExceededError";
  }
}
export class YouTubeRequestError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
    readonly reason: string | null,
  ) {
    super(message);
    this.name = "YouTubeRequestError";
  }
}
export class MalformedResponseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MalformedResponseError";
  }
}

// ---- Response schemas (only the fields we use) ----

const countString = z.string().regex(/^\d+$/).optional();

const videoItemSchema = z.object({
  id: z.string(),
  snippet: z.object({
    publishedAt: z.string(),
    channelId: z.string(),
    channelTitle: z.string(),
    title: z.string(),
    tags: z.array(z.string()).optional(),
    categoryId: z.string().optional(),
  }),
  statistics: z
    .object({ viewCount: countString, likeCount: countString, commentCount: countString })
    .optional(),
  contentDetails: z.object({ duration: z.string().optional() }).optional(),
});
const videoListSchema = z.object({ items: z.array(videoItemSchema).default([]) });

const searchListSchema = z.object({
  items: z
    .array(z.object({ id: z.object({ videoId: z.string().optional() }) }))
    .default([]),
});

const channelListSchema = z.object({
  items: z
    .array(
      z.object({
        id: z.string(),
        statistics: z
          .object({ subscriberCount: countString, hiddenSubscriberCount: z.boolean().optional() })
          .optional(),
      }),
    )
    .default([]),
});

const categoryListSchema = z.object({
  items: z
    .array(z.object({ id: z.string(), snippet: z.object({ title: z.string() }) }))
    .default([]),
});

const errorBodySchema = z.object({
  error: z.object({
    message: z.string().optional(),
    errors: z.array(z.object({ reason: z.string().optional() })).optional(),
  }),
});

// ---- Our own shapes ----

export type YouTubeVideo = {
  videoId: string;
  channelId: string;
  channelTitle: string;
  title: string;
  publishedAt: string;
  durationSec: number | null;
  tags: string[];
  categoryId: string | null;
  views: number | null; // null = not available, never zero by default
  likes: number | null;
  comments: number | null;
};

export type QuotaUsage = { generalUnits: number; searchCalls: number };

type FetchFn = (url: string) => Promise<Response>;
type SleepFn = (ms: number) => Promise<void>;

const toCount = (s: string | undefined) => (s === undefined ? null : Number(s));

// ISO 8601 duration such as "PT1H2M3S" or "P1DT2H". Returns null if unparseable.
export function parseDuration(iso: string | undefined): number | null {
  if (!iso) return null;
  const m = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(iso);
  if (!m) return null;
  const [d, h, min, s] = m.slice(1).map((x) => Number(x ?? 0));
  return d * 86400 + h * 3600 + min * 60 + s;
}

function toVideo(item: z.infer<typeof videoItemSchema>): YouTubeVideo {
  return {
    videoId: item.id,
    channelId: item.snippet.channelId,
    channelTitle: item.snippet.channelTitle,
    title: item.snippet.title,
    publishedAt: item.snippet.publishedAt,
    durationSec: parseDuration(item.contentDetails?.duration),
    tags: item.snippet.tags ?? [],
    categoryId: item.snippet.categoryId ?? null,
    views: toCount(item.statistics?.viewCount),
    likes: toCount(item.statistics?.likeCount),
    comments: toCount(item.statistics?.commentCount),
  };
}

export function createYouTubeClient(opts: {
  apiKey: string;
  fetchFn?: FetchFn;
  sleep?: SleepFn;
}) {
  const fetchFn: FetchFn = opts.fetchFn ?? ((url) => fetch(url));
  const sleep: SleepFn = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  const usage: QuotaUsage = { generalUnits: 0, searchCalls: 0 };
  let quotaStopped = false;
  let networkCalls = 0;

  async function call(
    path: string,
    params: Record<string, string>,
    cost: { bucket: "general" | "search"; units: number },
  ): Promise<unknown> {
    const query = new URLSearchParams({ ...params, key: opts.apiKey });
    const url = `${API}/${path}?${query}`;

    for (let attempt = 0; ; attempt++) {
      if (quotaStopped) {
        throw new QuotaExceededError("Skipped: YouTube daily quota was exceeded earlier in this run");
      }
      if (cost.bucket === "search") usage.searchCalls += cost.units;
      else usage.generalUnits += cost.units;
      networkCalls++;

      let res: Response;
      try {
        res = await fetchFn(url);
      } catch {
        if (attempt < MAX_RETRIES) {
          await sleep(BACKOFF_MS[attempt]);
          continue;
        }
        throw new YouTubeRequestError(`${path}: network error after ${MAX_RETRIES + 1} attempts`, null, "network");
      }

      if (res.ok) {
        try {
          return await res.json();
        } catch {
          throw new MalformedResponseError(`${path}: response was not valid JSON`);
        }
      }

      const body = errorBodySchema.safeParse(await res.json().catch(() => null));
      const reason = body.success ? (body.data.error.errors?.[0]?.reason ?? null) : null;

      if (reason === "quotaExceeded" || reason === "dailyLimitExceeded") {
        quotaStopped = true;
        throw new QuotaExceededError();
      }
      const transient =
        res.status === 429 || res.status >= 500 || reason === "rateLimitExceeded" || reason === "userRateLimitExceeded";
      if (transient && attempt < MAX_RETRIES) {
        await sleep(BACKOFF_MS[attempt]);
        continue;
      }
      throw new YouTubeRequestError(`${path}: HTTP ${res.status}${reason ? ` (${reason})` : ""}`, res.status, reason);
    }
  }

  function parse<T>(schema: z.ZodType<T>, data: unknown, path: string): T {
    const result = schema.safeParse(data);
    if (!result.success) throw new MalformedResponseError(`${path}: unexpected response shape`);
    return result.data;
  }

  return {
    usage,
    get quotaStopped() {
      return quotaStopped;
    },
    get networkCalls() {
      return networkCalls;
    },

    // Trending videos in a region, optionally limited to one category. Includes stats.
    async mostPopular(regionCode: string, categoryId: number | null): Promise<YouTubeVideo[]> {
      const params: Record<string, string> = {
        part: "snippet,statistics,contentDetails",
        chart: "mostPopular",
        regionCode,
        maxResults: String(MAX_RESULTS_PER_PAGE),
      };
      if (categoryId !== null) params.videoCategoryId = String(categoryId);
      const data = await call("videos", params, { bucket: "general", units: COST_VIDEOS_LIST });
      return parse(videoListSchema, data, "videos.list mostPopular").items.map(toVideo);
    },

    // IDs of recent uploads for a keyword, most viewed first. One page only.
    async search(
      keyword: string,
      o: { regionCode: string; relevanceLanguage: string; publishedAfter: Date },
    ): Promise<string[]> {
      const data = await call(
        "search",
        {
          part: "id",
          type: "video",
          q: keyword,
          order: "viewCount",
          regionCode: o.regionCode,
          relevanceLanguage: o.relevanceLanguage,
          publishedAfter: o.publishedAfter.toISOString(),
          maxResults: String(MAX_RESULTS_PER_PAGE),
        },
        { bucket: "search", units: COST_SEARCH_LIST },
      );
      return parse(searchListSchema, data, "search.list")
        .items.map((i) => i.id.videoId)
        .filter((id): id is string => Boolean(id));
    },

    // Full details for up to 50 IDs. Missing IDs are deleted, private or invalid.
    async videosByIds(ids: string[]): Promise<YouTubeVideo[]> {
      if (ids.length > MAX_IDS_PER_REQUEST) throw new Error("videosByIds: at most 50 IDs per call");
      const data = await call(
        "videos",
        { part: "snippet,statistics,contentDetails", id: ids.join(","), maxResults: String(MAX_IDS_PER_REQUEST) },
        { bucket: "general", units: COST_VIDEOS_LIST },
      );
      return parse(videoListSchema, data, "videos.list by id").items.map(toVideo);
    },

    // Subscriber counts for up to 50 channels. Hidden counts come back as null.
    async channelSubscribers(ids: string[]): Promise<Map<string, number | null>> {
      if (ids.length > MAX_IDS_PER_REQUEST) throw new Error("channelSubscribers: at most 50 IDs per call");
      const data = await call(
        "channels",
        { part: "statistics", id: ids.join(","), maxResults: String(MAX_IDS_PER_REQUEST) },
        { bucket: "general", units: COST_CHANNELS_LIST },
      );
      const out = new Map<string, number | null>();
      for (const c of parse(channelListSchema, data, "channels.list").items) {
        const hidden = c.statistics?.hiddenSubscriberCount === true;
        out.set(c.id, hidden ? null : toCount(c.statistics?.subscriberCount));
      }
      return out;
    },

    async videoCategories(regionCode: string): Promise<{ id: string; title: string }[]> {
      const data = await call(
        "videoCategories",
        { part: "snippet", regionCode },
        { bucket: "general", units: COST_VIDEO_CATEGORIES_LIST },
      );
      return parse(categoryListSchema, data, "videoCategories.list").items.map((c) => ({
        id: c.id,
        title: c.snippet.title,
      }));
    },
  };
}

export type YouTubeClient = ReturnType<typeof createYouTubeClient>;
