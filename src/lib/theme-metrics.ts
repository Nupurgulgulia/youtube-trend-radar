import { RECENT_UPLOAD_DAYS } from "./config/scoring";
import { computeConfidence, type Confidence } from "./confidence";
import { findings, type Findings } from "./findings";
import { computeMomentum, videoDelta, type Momentum, type PastTheme, type SnapshotPoint } from "./momentum";
import type { ScoredVideo } from "./scorer";
import { daysBetween, distinct, median, round } from "./stats";

// Everything measured about one theme (map step 7). The Theme Gate recomputes this
// from stored records, and Gemini only ever sees these numbers.

export type ThemeMetrics = {
  videoCount: number;
  creatorCount: number;
  dateRange: { from: string; to: string };
  medianViewsPerDay: number | null;
  medianBandIndex: number | null;
  medianEngagement: number | null;
  engagementSample: number;
  viewCoverage: number;
  recentUploadCount: number;
  trackedVideos: number;
  gainRatio: number | null;
  momentum: Momentum;
  momentumReasons: string[];
  confidence: Confidence;
  confidenceReasons: string[];
  findings: Findings;
};

export function themeMetrics(
  videos: ScoredVideo[],
  histories: Map<string, SnapshotPoint[]>,
  pastTheme: PastTheme | null,
  observedAt: string,
): ThemeMetrics {
  const n = videos.length;
  const creatorCount = distinct(videos.map((v) => v.channelId));
  const withViews = videos.filter((v) => v.viewsPerDay !== null);
  const engagement = videos.map((v) => v.engagementRate).filter((x): x is number => x !== null);
  const bandIndex = median(videos.map((v) => v.bandIndex).filter((x): x is number => x !== null));
  const recentUploadCount = videos.filter((v) => daysBetween(v.publishedAt, observedAt) <= RECENT_UPLOAD_DAYS).length;
  const published = videos.map((v) => v.publishedAt).sort();

  const momentum = computeMomentum({
    videoCount: n,
    creatorCount,
    viewCoverage: n === 0 ? 0 : withViews.length / n,
    medianBandIndex: bandIndex,
    recentUploadCount,
    deltas: videos.map((v) => videoDelta(histories.get(v.videoId) ?? [])),
    pastTheme,
  });
  const confidence = computeConfidence({
    videoCount: n,
    creatorCount,
    engagementCoverage: n === 0 ? 0 : engagement.length / n,
    hasHistory: momentum.hasHistory,
    momentum: momentum.label,
  });

  return {
    videoCount: n,
    creatorCount,
    dateRange: { from: published[0] ?? observedAt, to: published[n - 1] ?? observedAt },
    medianViewsPerDay: round(median(withViews.map((v) => v.viewsPerDay as number)), 0),
    medianBandIndex: round(bandIndex),
    medianEngagement: round(median(engagement), 4),
    engagementSample: engagement.length,
    viewCoverage: round(n === 0 ? 0 : withViews.length / n) as number,
    recentUploadCount,
    trackedVideos: momentum.trackedVideos,
    gainRatio: momentum.gainRatio,
    momentum: momentum.label,
    momentumReasons: momentum.reasons,
    confidence: confidence.level,
    confidenceReasons: confidence.reasons,
    findings: findings(videos),
  };
}
