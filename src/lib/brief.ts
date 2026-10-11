import type { SourceReport } from "./collector";
import type { Findings } from "./findings";
import type { NewsItem } from "./news";
import type { PublishResult } from "./publish-gate";
import { WRITTEN_FAILED_NOTE } from "./publish-gate";
import type { ScoredVideo } from "./scorer";
import type { GatedTheme } from "./theme-gate";
import type { ThemeEvidence, WrittenTheme } from "./write";

// The published brief (map steps 12 and 13). Everything is plain data: measured numbers
// from code, written parts from Gemini that passed the Publish Gate, kept apart so the
// page can style facts and interpretation differently.

export type BriefTheme = {
  slug: string;
  name: string;
  momentum: string;
  confidence: string;
  isNew: boolean;
  recurringFromWeek: string | null;
  measured: ThemeEvidence["metrics"];
  momentumReasons: string[];
  confidenceReasons: string[];
  findings: Findings;
  videos: ThemeEvidence["videos"];
  news: NewsItem[];
  chosenNews: NewsItem | null; // the item Gemini referenced, taken from our data, not its text
  written: Omit<WrittenTheme, "slug" | "momentum" | "confidence" | "news_index"> | null;
  writtenNote: string | null;
};

export type Coverage = {
  videosScanned: number;
  creators: number;
  keywordsSearched: string[];
  keywordsSkipped: { keyword: string; reason: string }[];
  sources: SourceReport | null;
  quotaUsed: number | null;
  quotaEstimated: number | null;
  searchCalls: number | null;
  firstRun: boolean;
  droppedThemes: { name: string; errors: string[] }[];
  limitations: string[];
};

export type BriefContent = {
  weekId: string;
  status: "succeeded" | "thin";
  generatedAt: string;
  executiveSummary: string;
  summaryFromCode: boolean;
  thinWeekNote: string | null;
  topOpportunities: { slug: string; name: string; reason: string }[];
  themes: BriefTheme[];
  coverage: Coverage;
};

export const THIN_WEEK_NOTE =
  "Thin week: fewer than 3 themes passed the quality checks. Nothing was added to fill the gap.";

export function limitationsFor(videos: ScoredVideo[], firstRun: boolean, sources: SourceReport | null): string[] {
  const out: string[] = [];
  if (firstRun) {
    out.push("First run: no earlier snapshots exist, so momentum can only be established or insufficient evidence, and confidence cannot be high.");
  }
  const other = videos.filter((v) => v.format === "other").length;
  if (videos.length > 0 && other / videos.length > 0.5) {
    out.push(`Format rules only read English keywords: ${other} of ${videos.length} videos could not be given a format.`);
  }
  if (sources?.news.status !== "ok" && sources) out.push(`News was ${sources.news.status}: outside context may be missing.`);
  if (sources?.youtube.status === "partial") out.push(`YouTube collection was partial: ${sources.youtube.reason}`);
  out.push("Views per day are compared with other videos collected this week, not with all of YouTube.");
  return out;
}

export function assembleBrief(input: {
  weekId: string;
  status: "succeeded" | "thin";
  generatedAt: string;
  themes: GatedTheme[];
  evidence: ThemeEvidence[];
  newsByTheme: Map<string, NewsItem[]>;
  publish: PublishResult;
  coverage: Coverage;
}): BriefContent {
  const names = new Map(input.themes.map((t) => [t.slug, t.name]));
  return {
    weekId: input.weekId,
    status: input.status,
    generatedAt: input.generatedAt,
    executiveSummary: input.publish.executiveSummary,
    summaryFromCode: input.publish.summaryFromCode,
    thinWeekNote: input.status === "thin" ? THIN_WEEK_NOTE : null,
    topOpportunities: input.publish.topOpportunities.map((o) => ({ ...o, name: names.get(o.slug) ?? o.slug })),
    themes: input.themes.map((t, i) => {
      const e = input.evidence[i];
      const w = input.publish.written.get(t.slug) ?? null;
      const news = input.newsByTheme.get(t.slug) ?? [];
      return {
        slug: t.slug,
        name: t.name,
        momentum: t.metrics.momentum,
        confidence: t.metrics.confidence,
        isNew: t.isNew,
        recurringFromWeek: t.recurringFromWeek,
        measured: e.metrics,
        momentumReasons: t.metrics.momentumReasons,
        confidenceReasons: t.metrics.confidenceReasons,
        findings: t.metrics.findings,
        videos: e.videos,
        news,
        chosenNews: w && w.news_index !== null ? (news[w.news_index] ?? null) : null,
        written: w
          ? {
              why_this_week: w.why_this_week,
              youtube_evidence: w.youtube_evidence,
              outside_context: w.outside_context,
              interpretation: w.interpretation,
              filming_angle: w.filming_angle,
              uncertain: w.uncertain,
            }
          : null,
        writtenNote: w ? null : WRITTEN_FAILED_NOTE,
      };
    }),
    coverage: input.coverage,
  };
}
