import { classifyFormat, type Format } from "./config/formats";
import { AGE_BANDS, LENGTH_BUCKETS, MIN_AGE_DAYS, MIN_VIEWS_FOR_ENGAGEMENT } from "./config/scoring";
import { daysBetween, median } from "./stats";

// Scorer, per-video part (map step 7). Code only, no AI.

export type AgeBand = (typeof AGE_BANDS)[number]["band"];
export type LengthBucket = (typeof LENGTH_BUCKETS)[number]["bucket"] | "unknown";

// The fields the scorer needs, whether they come from the collector or the database.
export type VideoInput = {
  videoId: string;
  channelId: string;
  channelTitle: string;
  title: string;
  publishedAt: string;
  durationSec: number | null;
  tags: string[];
  views: number | null;
  likes: number | null;
  comments: number | null;
  // Sources that surfaced the video in this run, e.g. "trending:28", "search:AI tools".
  foundBy?: string[];
};

export type ScoredVideo = VideoInput & {
  ageDays: number;
  ageBand: AgeBand;
  viewsPerDay: number | null;
  engagementRate: number | null;
  lengthBucket: LengthBucket;
  format: Format;
  // viewsPerDay divided by the median viewsPerDay of all videos in the same age band
  // in this run. 1.0 = typical for its age. null when not computable.
  bandIndex: number | null;
};

export function ageDays(publishedAt: string, observedAt: string): number {
  return Math.max(MIN_AGE_DAYS, daysBetween(publishedAt, observedAt));
}

export function ageBand(days: number): AgeBand {
  return AGE_BANDS.find((b) => days < b.belowDays)!.band;
}

export function lengthBucket(durationSec: number | null): LengthBucket {
  if (durationSec === null) return "unknown";
  return LENGTH_BUCKETS.find((b) => durationSec <= b.maxSec)!.bucket;
}

// null unless likes, comments and views are all present and views meet the minimum.
export function engagementRate(views: number | null, likes: number | null, comments: number | null): number | null {
  if (views === null || likes === null || comments === null) return null;
  if (views < MIN_VIEWS_FOR_ENGAGEMENT) return null;
  return (likes + comments) / views;
}

export function scoreVideos(videos: VideoInput[], observedAt: string): ScoredVideo[] {
  const base = videos.map((v) => {
    const age = ageDays(v.publishedAt, observedAt);
    return {
      ...v,
      ageDays: age,
      ageBand: ageBand(age),
      viewsPerDay: v.views === null ? null : v.views / age,
      engagementRate: engagementRate(v.views, v.likes, v.comments),
      lengthBucket: lengthBucket(v.durationSec),
      format: classifyFormat(v.title, v.tags),
    };
  });

  const bandMedians = new Map<AgeBand, number | null>();
  for (const { band } of AGE_BANDS) {
    const vpd = base.filter((v) => v.ageBand === band && v.viewsPerDay !== null).map((v) => v.viewsPerDay as number);
    bandMedians.set(band, median(vpd));
  }

  return base.map((v) => {
    const m = bandMedians.get(v.ageBand) ?? null;
    return { ...v, bandIndex: v.viewsPerDay === null || !m ? null : v.viewsPerDay / m };
  });
}
