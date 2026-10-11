import {
  ESTABLISHED_MIN_CREATORS,
  FADING_RATIO,
  MIN_SNAPSHOT_GAP_DAYS,
  MIN_THEME_CREATORS,
  MIN_THEME_VIDEOS,
  MIN_TRACKED_VIDEOS,
  MIN_VIEW_COVERAGE,
  RISING_RATIO,
  STRONG_BAND_INDEX,
} from "./config/scoring";
import { daysBetween, median, round } from "./stats";

// Momentum (map step 7). Popularity is not acceleration: "rising" and "fading" need
// stored snapshots of the same videos at least MIN_SNAPSHOT_GAP_DAYS apart.
// A single snapshot can only ever give "established" or "insufficient_evidence".

export type Momentum = "rising" | "established" | "fading" | "insufficient_evidence";

export type SnapshotPoint = { observedAt: string; views: number };

export type VideoDelta = {
  // Views gained per day between the latest snapshot and the latest earlier one
  // at least the minimum gap before it. null if there is no such snapshot.
  current: number | null;
  // Same, for the interval before that. null if there is no such interval.
  previous: number | null;
  // True when earlier snapshots exist but all are too close to compare.
  tooClose: boolean;
};

function latestBefore(points: SnapshotPoint[], fromIndex: number): number | null {
  for (let i = fromIndex - 1; i >= 0; i--) {
    if (daysBetween(points[i].observedAt, points[fromIndex].observedAt) >= MIN_SNAPSHOT_GAP_DAYS) return i;
  }
  return null;
}

const gainPerDay = (a: SnapshotPoint, b: SnapshotPoint) =>
  (b.views - a.views) / daysBetween(a.observedAt, b.observedAt);

export function videoDelta(history: SnapshotPoint[]): VideoDelta {
  const points = [...history].sort((a, b) => a.observedAt.localeCompare(b.observedAt));
  const last = points.length - 1;
  if (last < 1) return { current: null, previous: null, tooClose: false };
  const mid = latestBefore(points, last);
  if (mid === null) return { current: null, previous: null, tooClose: true };
  const first = latestBefore(points, mid);
  return {
    current: gainPerDay(points[mid], points[last]),
    previous: first === null ? null : gainPerDay(points[first], points[mid]),
    tooClose: false,
  };
}

// What the matching theme looked like in an earlier week (stored in themes.metrics).
export type PastTheme = { weekId: string; creatorCount: number; recentUploadCount: number };

export type MomentumInput = {
  videoCount: number;
  creatorCount: number;
  viewCoverage: number; // share of videos with a view count
  medianBandIndex: number | null;
  recentUploadCount: number;
  deltas: VideoDelta[];
  pastTheme: PastTheme | null;
};

export type MomentumResult = {
  label: Momentum;
  reasons: string[];
  trackedVideos: number; // videos with a comparable earlier snapshot
  gainRatio: number | null; // median current gain / median previous gain
  hasHistory: boolean;
};

export function computeMomentum(input: MomentumInput): MomentumResult {
  const tracked = input.deltas.filter((d) => d.current !== null);
  const result = (label: Momentum, reasons: string[], gainRatio: number | null = null): MomentumResult => ({
    label,
    reasons,
    trackedVideos: tracked.length,
    gainRatio: round(gainRatio),
    hasHistory: tracked.length >= MIN_TRACKED_VIDEOS,
  });

  // 1. Not enough to say anything.
  if (input.videoCount < MIN_THEME_VIDEOS) {
    return result("insufficient_evidence", [`Only ${input.videoCount} videos (need ${MIN_THEME_VIDEOS}).`]);
  }
  if (input.creatorCount < MIN_THEME_CREATORS) {
    return result("insufficient_evidence", [`Only ${input.creatorCount} creator (need ${MIN_THEME_CREATORS}).`]);
  }
  if (input.viewCoverage < MIN_VIEW_COVERAGE) {
    return result("insufficient_evidence", ["Too many videos are missing view counts."]);
  }

  // 2. History exists but every earlier snapshot is too recent to compare.
  const tooClose = input.deltas.filter((d) => d.tooClose).length;
  if (tracked.length < MIN_TRACKED_VIDEOS && tooClose + tracked.length >= MIN_TRACKED_VIDEOS) {
    return result("insufficient_evidence", [
      `Earlier snapshots are less than ${MIN_SNAPSHOT_GAP_DAYS} days old, too close to compare.`,
    ]);
  }

  // 3. Comparable history: look for acceleration or decline.
  if (tracked.length >= MIN_TRACKED_VIDEOS) {
    const both = tracked.filter((d) => d.previous !== null);
    let ratio: number | null = null;
    if (both.length >= MIN_TRACKED_VIDEOS) {
      const cur = median(both.map((d) => d.current as number));
      const prev = median(both.map((d) => d.previous as number));
      if (cur !== null && prev !== null && prev > 0) ratio = cur / prev;
    }
    const creatorsGrew = input.pastTheme !== null && input.creatorCount > input.pastTheme.creatorCount;
    const uploadsDidNotGrow =
      input.pastTheme !== null && input.recentUploadCount <= input.pastTheme.recentUploadCount;

    if (ratio !== null && ratio >= RISING_RATIO) {
      return result("rising", [`Median views gained per day rose ${round(ratio)}x versus the previous interval.`], ratio);
    }
    if (ratio !== null && ratio <= FADING_RATIO && uploadsDidNotGrow) {
      return result("fading", [
        `Median views gained per day fell to ${round(ratio)}x of the previous interval, and new uploads did not increase.`,
      ], ratio);
    }
    if (creatorsGrew && (ratio === null || ratio > FADING_RATIO)) {
      return result("rising", [
        `Distinct creators grew from ${input.pastTheme!.creatorCount} (${input.pastTheme!.weekId}) to ${input.creatorCount}.`,
      ], ratio);
    }
    // History shows neither acceleration nor decline: fall through to established.
  }

  // 4. Popular now, but no history showing a direction.
  const strong = input.medianBandIndex !== null && input.medianBandIndex >= STRONG_BAND_INDEX;
  if (input.creatorCount >= ESTABLISHED_MIN_CREATORS && strong) {
    return result("established", [
      `${input.creatorCount} creators, median views per day ${round(input.medianBandIndex)}x the typical video of the same age.`,
      tracked.length >= MIN_TRACKED_VIDEOS ? "History shows no clear acceleration or decline." : "No comparable history yet.",
    ]);
  }
  return result("insufficient_evidence", [
    input.creatorCount < ESTABLISHED_MIN_CREATORS
      ? `Only ${input.creatorCount} creators (need ${ESTABLISHED_MIN_CREATORS} to call it established).`
      : "Views per day are below the typical video of the same age.",
  ]);
}
