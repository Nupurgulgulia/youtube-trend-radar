import { describe, expect, it } from "vitest";
import { estimateQuota, planQuota } from "@/lib/quota";
import { defaultSettings } from "./fixtures/settings";

const budget = { dailyQuota: 10_000, searchDailyLimit: 100, safetyMargin: 0.5 };

describe("estimateQuota", () => {
  it("matches a hand calculation for the default settings", () => {
    // Hand calculation, 1 category, 6 keywords, 120 tracked videos, channels on:
    //   trending:        1 category x 1 call                         = 1 unit
    //   search videos:   6 keywords x 50 IDs = 300 IDs / 50          = 6 units
    //   tracked videos:  120 IDs / 50, rounded up                    = 3 units
    //   channels:        (50 + 300 + 120) = 470 IDs / 50, rounded up = 10 units
    //   general total                                                = 20 units
    //   search bucket:   6 keywords x 1 call                         = 6 calls
    const e = estimateQuota(defaultSettings, { trackedVideoCount: 120, includeChannels: true });
    expect(e.breakdown).toEqual({
      trendingCalls: 1,
      searchVideoBatches: 6,
      trackedVideoBatches: 3,
      channelBatches: 10,
    });
    expect(e.generalUnits).toBe(20);
    expect(e.searchCalls).toBe(6);
  });

  it("makes one region-wide trending call when no category is set", () => {
    const e = estimateQuota({ ...defaultSettings, categoryIds: [], keywords: [] });
    expect(e.breakdown.trendingCalls).toBe(1);
    expect(e.generalUnits).toBe(1);
    expect(e.searchCalls).toBe(0);
  });

  it("does not count channel lookups when they are switched off", () => {
    const e = estimateQuota(defaultSettings);
    expect(e.breakdown.channelBatches).toBe(0);
    expect(e.generalUnits).toBe(1 + 6);
  });
});

describe("planQuota", () => {
  it("keeps every keyword when the run fits", () => {
    const plan = planQuota(defaultSettings, budget, { includeChannels: true });
    expect(plan.fits).toBe(true);
    expect(plan.keywordsUsed).toEqual(defaultSettings.keywords);
    expect(plan.keywordsSkipped).toEqual([]);
    expect(plan.limits).toEqual({ generalUnits: 5000, searchCalls: 50 });
  });

  it("cuts the lowest-priority keywords when searches exceed the budget", () => {
    // 60 keywords need 60 searches, but the budget allows 100 x 0.5 = 50.
    const keywords = Array.from({ length: 60 }, (_, i) => `keyword ${i + 1}`);
    const plan = planQuota({ ...defaultSettings, keywords }, budget);
    expect(plan.fits).toBe(true);
    expect(plan.keywordsUsed).toHaveLength(50);
    expect(plan.keywordsUsed[0]).toBe("keyword 1");
    expect(plan.keywordsSkipped.map((s) => s.keyword)).toEqual(keywords.slice(50));
    expect(plan.keywordsSkipped[0].reason).toContain("quota budget");
  });

  it("cuts keywords when general units exceed the budget", () => {
    // Small budget: 20 x 0.5 = 10 units. Trending (1) + 1 batch per keyword,
    // so at most 9 keywords fit.
    const keywords = Array.from({ length: 12 }, (_, i) => `k${i}`);
    const plan = planQuota({ ...defaultSettings, keywords }, { ...budget, dailyQuota: 20 });
    expect(plan.estimate.generalUnits).toBe(10);
    expect(plan.keywordsUsed).toHaveLength(9);
    expect(plan.keywordsSkipped).toHaveLength(3);
  });

  it("reports a problem when even zero keywords do not fit", () => {
    const plan = planQuota(defaultSettings, { ...budget, dailyQuota: 4 }, { trackedVideoCount: 500 });
    expect(plan.fits).toBe(false);
    expect(plan.keywordsUsed).toEqual([]);
    expect(plan.problem).toContain("above");
  });
});
