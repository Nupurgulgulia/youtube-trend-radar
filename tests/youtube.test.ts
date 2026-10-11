import { describe, expect, it } from "vitest";
import { createYouTubeClient, MalformedResponseError, parseDuration, QuotaExceededError } from "@/lib/youtube";
import { apiError, fakeFetch, json, noSleep, videoItem } from "./fixtures/youtube";

const client = (handlers: Parameters<typeof fakeFetch>[0]) => {
  const fake = fakeFetch(handlers);
  return { yt: createYouTubeClient({ apiKey: "SECRET-KEY", fetchFn: fake.fn, sleep: noSleep }), fake };
};

describe("parseDuration", () => {
  it("parses common ISO 8601 durations", () => {
    expect(parseDuration("PT8M30S")).toBe(510);
    expect(parseDuration("PT1H")).toBe(3600);
    expect(parseDuration("P1DT2M")).toBe(86_520);
    expect(parseDuration("P0D")).toBe(0);
  });
  it("returns null for missing or unknown formats", () => {
    expect(parseDuration(undefined)).toBeNull();
    expect(parseDuration("8 minutes")).toBeNull();
  });
});

describe("YouTube client", () => {
  it("keeps missing statistics as null, not zero", async () => {
    const { yt } = client({ videos: () => json({ items: [videoItem({ id: "v1", views: "1200" })] }) });
    const [v] = await yt.mostPopular("IN", 28);
    expect(v.views).toBe(1200);
    expect(v.likes).toBeNull();
    expect(v.comments).toBeNull();
    expect(v.durationSec).toBe(510);
  });

  it("does not retry a quota error and refuses every later call", async () => {
    const { yt, fake } = client({ videos: () => apiError(403, "quotaExceeded") });
    await expect(yt.mostPopular("IN", 28)).rejects.toBeInstanceOf(QuotaExceededError);
    await expect(yt.videosByIds(["a"])).rejects.toBeInstanceOf(QuotaExceededError);
    expect(fake.calls).toHaveLength(1);
    expect(yt.quotaStopped).toBe(true);
  });

  it("retries a rate limit and succeeds", async () => {
    let n = 0;
    const { yt, fake } = client({
      videos: () => (++n === 1 ? apiError(403, "rateLimitExceeded") : json({ items: [] })),
    });
    await expect(yt.mostPopular("IN", null)).resolves.toEqual([]);
    expect(fake.calls).toHaveLength(2);
    expect(yt.usage.generalUnits).toBe(2); // both attempts cost quota
  });

  it("retries a server error at most twice", async () => {
    const { yt, fake } = client({ videos: () => json({}, 503) });
    await expect(yt.mostPopular("IN", 28)).rejects.toThrow("HTTP 503");
    expect(fake.calls).toHaveLength(3);
  });

  it("rejects a malformed response", async () => {
    const { yt } = client({ videos: () => json({ items: [{ id: 42 }] }) });
    await expect(yt.mostPopular("IN", 28)).rejects.toBeInstanceOf(MalformedResponseError);
  });

  it("never puts the API key in an error message", async () => {
    const { yt } = client({ videos: () => apiError(400, "badRequest") });
    const err = await yt.mostPopular("IN", 28).catch((e: Error) => e);
    expect(String((err as Error).message)).not.toContain("SECRET-KEY");
  });

  it("counts search calls in their own bucket", async () => {
    const { yt } = client({ search: () => json({ items: [{ id: { videoId: "s1" } }, { id: {} }] }) });
    const ids = await yt.search("AI tools", {
      regionCode: "IN",
      relevanceLanguage: "en",
      publishedAfter: new Date("2026-10-04T00:00:00Z"),
    });
    expect(ids).toEqual(["s1"]);
    expect(yt.usage).toEqual({ generalUnits: 0, searchCalls: 1 });
  });
});
