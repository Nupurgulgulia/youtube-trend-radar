import {
  COST_CHANNELS_LIST,
  COST_SEARCH_LIST,
  COST_VIDEOS_LIST,
  MAX_IDS_PER_REQUEST,
  MAX_RESULTS_PER_PAGE,
  PAGES_PER_CALL,
} from "./config/quota";
import type { Settings } from "./types";

// Quota estimator (map step 6, "Collects within a quota budget").
// It runs before any YouTube request and gives a worst-case (upper bound) count,
// assuming every search returns a full page of brand-new videos from new channels.
// The real count is usually lower because duplicates are removed first.

export type QuotaOptions = {
  // Videos from earlier weeks whose stats we refresh so momentum can compare snapshots.
  trackedVideoCount?: number;
  // Whether to look up subscriber counts (optional, only used for small/big channel flags).
  includeChannels?: boolean;
};

export type QuotaEstimate = {
  searchCalls: number; // counts against the search.list bucket
  generalUnits: number; // counts against the 10,000-unit bucket
  breakdown: {
    trendingCalls: number;
    searchVideoBatches: number;
    trackedVideoBatches: number;
    channelBatches: number;
  };
};

export type QuotaBudget = {
  dailyQuota: number; // general bucket, YOUTUBE_DAILY_QUOTA
  searchDailyLimit: number; // search bucket, YOUTUBE_SEARCH_DAILY_LIMIT
  safetyMargin: number; // QUOTA_SAFETY_MARGIN, fraction of each bucket one run may use
};

export type QuotaPlan = {
  fits: boolean;
  keywordsUsed: string[];
  keywordsSkipped: { keyword: string; reason: string }[];
  estimate: QuotaEstimate;
  limits: { generalUnits: number; searchCalls: number };
  problem: string | null;
};

const batches = (count: number) => Math.ceil(count / MAX_IDS_PER_REQUEST);

export function estimateQuota(settings: Settings, options: QuotaOptions = {}): QuotaEstimate {
  const keywordCount = settings.keywords.length;
  const tracked = options.trackedVideoCount ?? 0;

  // One mostPopular call per category, or one region-wide call when no category is set.
  // Trending results already include statistics, so they need no extra videos.list call.
  const trendingCalls = Math.max(1, settings.categoryIds.length) * PAGES_PER_CALL;

  // Search results only carry IDs, so each one needs a videos.list lookup for stats.
  const searchResultIds = keywordCount * MAX_RESULTS_PER_PAGE * PAGES_PER_CALL;
  const searchVideoBatches = batches(searchResultIds);
  const trackedVideoBatches = batches(tracked);

  // Worst case: every video comes from a different channel.
  const trendingIds = trendingCalls * MAX_RESULTS_PER_PAGE;
  const channelBatches = options.includeChannels
    ? batches(trendingIds + searchResultIds + tracked)
    : 0;

  return {
    searchCalls: keywordCount * PAGES_PER_CALL * COST_SEARCH_LIST,
    generalUnits:
      (trendingCalls + searchVideoBatches + trackedVideoBatches) * COST_VIDEOS_LIST +
      channelBatches * COST_CHANNELS_LIST,
    breakdown: { trendingCalls, searchVideoBatches, trackedVideoBatches, channelBatches },
  };
}

// Fits the run inside the budget by dropping the lowest-priority keywords (the end
// of the list) until both buckets are within their limits.
export function planQuota(
  settings: Settings,
  budget: QuotaBudget,
  options: QuotaOptions = {},
): QuotaPlan {
  const limits = {
    generalUnits: Math.floor(budget.dailyQuota * budget.safetyMargin),
    searchCalls: Math.floor(budget.searchDailyLimit * budget.safetyMargin),
  };
  const fitsLimits = (e: QuotaEstimate) =>
    e.generalUnits <= limits.generalUnits && e.searchCalls <= limits.searchCalls;

  const keywordsUsed = [...settings.keywords];
  const keywordsSkipped: QuotaPlan["keywordsSkipped"] = [];
  let estimate = estimateQuota({ ...settings, keywords: keywordsUsed }, options);

  while (!fitsLimits(estimate) && keywordsUsed.length > 0) {
    const keyword = keywordsUsed.pop() as string;
    keywordsSkipped.unshift({
      keyword,
      reason: `Skipped to stay within the quota budget (${limits.generalUnits} units and ${limits.searchCalls} searches per run).`,
    });
    estimate = estimateQuota({ ...settings, keywords: keywordsUsed }, options);
  }

  const fits = fitsLimits(estimate);
  return {
    fits,
    keywordsUsed,
    keywordsSkipped,
    estimate,
    limits,
    problem: fits
      ? null
      : `Even with no keywords, trending and tracked videos need ${estimate.generalUnits} units, above the ${limits.generalUnits}-unit budget.`,
  };
}
