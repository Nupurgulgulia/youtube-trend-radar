import { MIN_FORMAT_CREATORS, MIN_FORMAT_SAMPLE, SAMPLE_TOO_SMALL } from "./config/scoring";
import type { ScoredVideo } from "./scorer";
import { distinct, median, round } from "./stats";

// Format and length findings (map step 7). Every group reports its sample size and
// creator count. A ranking is only given between groups that are big enough.

export type GroupStat = {
  group: string;
  videos: number;
  creators: number;
  medianViewsPerDay: number | null;
  medianBandIndex: number | null; // views per day relative to videos of the same age
  medianEngagement: number | null;
  engagementSample: number;
  comparable: boolean; // meets MIN_FORMAT_SAMPLE and MIN_FORMAT_CREATORS
};

export type Comparison =
  | { status: "ranked"; ranking: { group: string; medianBandIndex: number }[] }
  | { status: "too_small"; message: typeof SAMPLE_TOO_SMALL };

export type Findings = {
  formats: GroupStat[];
  lengths: GroupStat[];
  formatComparison: Comparison;
  lengthComparison: Comparison;
  // Formats compared inside one length bucket, so shorts are not compared with long videos.
  formatsByLength: { length: string; formats: GroupStat[]; comparison: Comparison }[];
};

function groupStats(videos: ScoredVideo[], key: (v: ScoredVideo) => string): GroupStat[] {
  const groups = new Map<string, ScoredVideo[]>();
  for (const v of videos) {
    const k = key(v);
    groups.set(k, [...(groups.get(k) ?? []), v]);
  }
  return [...groups.entries()]
    .map(([group, vs]) => {
      const creators = distinct(vs.map((v) => v.channelId));
      const engagement = vs.map((v) => v.engagementRate).filter((x): x is number => x !== null);
      return {
        group,
        videos: vs.length,
        creators,
        medianViewsPerDay: round(median(vs.map((v) => v.viewsPerDay).filter((x): x is number => x !== null)), 0),
        medianBandIndex: round(median(vs.map((v) => v.bandIndex).filter((x): x is number => x !== null))),
        medianEngagement: round(median(engagement), 4),
        engagementSample: engagement.length,
        comparable: vs.length >= MIN_FORMAT_SAMPLE && creators >= MIN_FORMAT_CREATORS,
      };
    })
    .sort((a, b) => b.videos - a.videos);
}

function compare(stats: GroupStat[]): Comparison {
  const eligible = stats.filter((s) => s.comparable && s.medianBandIndex !== null);
  if (eligible.length < 2) return { status: "too_small", message: SAMPLE_TOO_SMALL };
  return {
    status: "ranked",
    ranking: eligible
      .map((s) => ({ group: s.group, medianBandIndex: s.medianBandIndex as number }))
      .sort((a, b) => b.medianBandIndex - a.medianBandIndex),
  };
}

export function findings(videos: ScoredVideo[]): Findings {
  const formats = groupStats(videos, (v) => v.format);
  const lengths = groupStats(videos, (v) => v.lengthBucket);
  const formatsByLength = lengths.map(({ group: length }) => {
    const inBucket = groupStats(videos.filter((v) => v.lengthBucket === length), (v) => v.format);
    return { length, formats: inBucket, comparison: compare(inBucket) };
  });
  return {
    formats,
    lengths,
    formatComparison: compare(formats),
    lengthComparison: compare(lengths),
    formatsByLength,
  };
}
