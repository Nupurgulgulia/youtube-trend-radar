import { describe, expect, it } from "vitest";
import { computeConfidence } from "@/lib/confidence";
import { computeMomentum, videoDelta, type MomentumInput, type SnapshotPoint, type VideoDelta } from "@/lib/momentum";

const strongTheme: Omit<MomentumInput, "deltas"> = {
  videoCount: 8,
  creatorCount: 5,
  viewCoverage: 1,
  medianBandIndex: 1.6,
  recentUploadCount: 6,
  pastTheme: null,
};
const delta = (current: number | null, previous: number | null = null, tooClose = false): VideoDelta => ({
  current,
  previous,
  tooClose,
});
const noHistory = Array.from({ length: 8 }, () => delta(null));

describe("videoDelta", () => {
  const p = (day: string, views: number): SnapshotPoint => ({ observedAt: `2026-10-${day}T00:30:00Z`, views });

  it("has nothing to compare with a single snapshot", () => {
    expect(videoDelta([p("11", 1000)])).toEqual({ current: null, previous: null, tooClose: false });
  });

  it("flags snapshots that are too close together", () => {
    expect(videoDelta([p("09", 900), p("11", 1000)])).toEqual({ current: null, previous: null, tooClose: true });
  });

  it("computes views gained per day across a week", () => {
    expect(videoDelta([p("04", 1000), p("11", 8000)])).toEqual({ current: 1000, previous: null, tooClose: false });
  });

  it("computes the previous interval when three spaced snapshots exist", () => {
    const d = videoDelta([p("01", 0), p("08", 700), p("15", 2100)]);
    expect(d.current).toBe(200);
    expect(d.previous).toBe(100);
  });

  it("skips a too-close middle snapshot and uses the one a week earlier", () => {
    const d = videoDelta([p("04", 1000), p("10", 6000), p("11", 8000)]);
    // Latest (11th) vs the latest snapshot at least 5 days earlier (4th): 7000 over 7 days.
    expect(d.current).toBe(1000);
  });
});

describe("computeMomentum", () => {
  it("first run: a strong theme is established, never rising or fading", () => {
    const r = computeMomentum({ ...strongTheme, deltas: noHistory });
    expect(r.label).toBe("established");
    expect(r.hasHistory).toBe(false);
  });

  it("first run: a weak theme is insufficient_evidence", () => {
    expect(computeMomentum({ ...strongTheme, medianBandIndex: 0.6, deltas: noHistory }).label).toBe(
      "insufficient_evidence",
    );
    expect(computeMomentum({ ...strongTheme, creatorCount: 1, deltas: noHistory }).label).toBe("insufficient_evidence");
    expect(computeMomentum({ ...strongTheme, videoCount: 2, deltas: noHistory }).label).toBe("insufficient_evidence");
  });

  it("first run: even a huge band index can't make a theme rising", () => {
    const r = computeMomentum({ ...strongTheme, medianBandIndex: 50, deltas: noHistory });
    expect(r.label).toBe("established");
  });

  it("rising when median gain per day accelerated by at least 1.25x", () => {
    const deltas = [delta(130, 100), delta(260, 200), delta(390, 300), delta(null)];
    const r = computeMomentum({ ...strongTheme, deltas });
    expect(r.label).toBe("rising");
    expect(r.gainRatio).toBe(1.3);
  });

  it("not rising at 1.2x: the history shows no clear change, so established", () => {
    const deltas = [delta(120, 100), delta(240, 200), delta(360, 300)];
    expect(computeMomentum({ ...strongTheme, deltas }).label).toBe("established");
  });

  it("rising when distinct creators grew versus the matching past theme", () => {
    const deltas = [delta(100), delta(200), delta(300)];
    const r = computeMomentum({
      ...strongTheme,
      deltas,
      pastTheme: { weekId: "2026-W40", creatorCount: 3, recentUploadCount: 4 },
    });
    expect(r.label).toBe("rising");
    expect(r.reasons[0]).toContain("from 3 (2026-W40) to 5");
  });

  it("fading when gain per day fell to 0.75x or less and uploads did not increase", () => {
    const deltas = [delta(70, 100), delta(140, 200), delta(210, 300)];
    const r = computeMomentum({
      ...strongTheme,
      recentUploadCount: 4,
      deltas,
      pastTheme: { weekId: "2026-W40", creatorCount: 5, recentUploadCount: 4 },
    });
    expect(r.label).toBe("fading");
  });

  it("not fading when new uploads increased", () => {
    const deltas = [delta(70, 100), delta(140, 200), delta(210, 300)];
    const r = computeMomentum({
      ...strongTheme,
      recentUploadCount: 9,
      deltas,
      pastTheme: { weekId: "2026-W40", creatorCount: 5, recentUploadCount: 4 },
    });
    expect(r.label).not.toBe("fading");
  });

  it("not fading without a past theme to compare uploads with", () => {
    const deltas = [delta(70, 100), delta(140, 200), delta(210, 300)];
    expect(computeMomentum({ ...strongTheme, deltas }).label).toBe("established");
  });

  it("snapshots too close together give insufficient_evidence", () => {
    const deltas = [delta(null, null, true), delta(null, null, true), delta(null, null, true), delta(null)];
    const r = computeMomentum({ ...strongTheme, deltas });
    expect(r.label).toBe("insufficient_evidence");
    expect(r.reasons[0]).toContain("too close");
  });

  it("fewer than 3 tracked videos is not history", () => {
    const deltas = [delta(500, 100), delta(500, 100), delta(null), delta(null)];
    const r = computeMomentum({ ...strongTheme, deltas });
    expect(r.label).toBe("established");
    expect(r.hasHistory).toBe(false);
  });
});

describe("computeConfidence", () => {
  const base = { videoCount: 10, creatorCount: 6, engagementCoverage: 0.9, hasHistory: true, momentum: "rising" as const };

  it("is high only with all four points, including history", () => {
    expect(computeConfidence(base).level).toBe("high");
    expect(computeConfidence({ ...base, hasHistory: false }).level).toBe("medium");
  });

  it("is medium with two points and low with one", () => {
    expect(computeConfidence({ ...base, hasHistory: false, engagementCoverage: 0.2 }).level).toBe("medium");
    expect(computeConfidence({ ...base, hasHistory: false, engagementCoverage: 0.2, creatorCount: 3 }).level).toBe("low");
  });

  it("is always low for insufficient_evidence", () => {
    expect(computeConfidence({ ...base, momentum: "insufficient_evidence" }).level).toBe("low");
  });

  it("explains every point", () => {
    expect(computeConfidence(base).reasons).toHaveLength(4);
  });
});
