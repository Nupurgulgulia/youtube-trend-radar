import { Type, type Schema } from "@google/genai";
import { z } from "zod";
import type { Comparison, Findings, GroupStat } from "./findings";
import type { NewsItem } from "./news";
import type { ScoredVideo } from "./scorer";
import { round } from "./stats";
import type { GatedTheme } from "./theme-gate";

// Gemini call 2: write (map step 10). Gemini receives the evidence built here and writes
// each theme in labelled parts. Every number it may use is in this evidence, already rounded.

export { NO_NEWS } from "./brief-text";
import { NO_NEWS } from "./brief-text";
export const VIDEOS_PER_THEME = 5;

export type ThemeEvidence = {
  slug: string;
  name: string;
  momentum: string;
  confidence: string;
  status_note: string; // "New this week" or "Recurring since 2026-W40"
  metrics: {
    video_count: number;
    creator_count: number;
    first_published: string; // YYYY-MM-DD
    last_published: string;
    median_views_per_day: number | null;
    views_per_day_vs_same_age_videos: number | null; // band index, e.g. 2.95 = 2.95x typical
    median_engagement_percent: number | null;
    videos_with_engagement: number;
  };
  momentum_reasons: string[];
  format_findings: string[];
  videos: { title: string; channel: string; published: string; link: string; views_per_day: number | null }[];
  news: { index: number; headline: string; source: string | null; date: string | null; link: string }[];
};

const day = (iso: string) => iso.slice(0, 10);
const pct = (x: number | null) => (x === null ? null : round(x * 100, 2));

function describeGroups(label: string, groups: GroupStat[], comparison: Comparison): string {
  const parts = groups.map((g) => `${g.group}: ${g.videos} videos from ${g.creators} creators`).join("; ");
  const verdict =
    comparison.status === "ranked"
      ? `ranking by views per day versus same-age videos: ${comparison.ranking.map((r) => `${r.group} ${r.medianBandIndex}x`).join(", ")}`
      : comparison.message;
  return `${label}: ${parts}. ${verdict}.`;
}

export function formatFindingsText(f: Findings): string[] {
  return [describeGroups("Formats", f.formats, f.formatComparison), describeGroups("Lengths", f.lengths, f.lengthComparison)];
}

export function buildEvidence(theme: GatedTheme, videosById: Map<string, ScoredVideo>, news: NewsItem[]): ThemeEvidence {
  const m = theme.metrics;
  const vids = theme.videoIds
    .map((id) => videosById.get(id)!)
    .sort((a, b) => (b.viewsPerDay ?? -1) - (a.viewsPerDay ?? -1))
    .slice(0, VIDEOS_PER_THEME);
  return {
    slug: theme.slug,
    name: theme.name,
    momentum: m.momentum,
    confidence: m.confidence,
    status_note: theme.isNew ? "New this week" : `Recurring since ${theme.recurringFromWeek}`,
    metrics: {
      video_count: m.videoCount,
      creator_count: m.creatorCount,
      first_published: day(m.dateRange.from),
      last_published: day(m.dateRange.to),
      median_views_per_day: m.medianViewsPerDay,
      views_per_day_vs_same_age_videos: m.medianBandIndex,
      median_engagement_percent: pct(m.medianEngagement),
      videos_with_engagement: m.engagementSample,
    },
    momentum_reasons: m.momentumReasons,
    format_findings: formatFindingsText(m.findings),
    videos: vids.map((v) => ({
      title: v.title,
      channel: v.channelTitle,
      published: day(v.publishedAt),
      link: `https://www.youtube.com/watch?v=${v.videoId}`,
      views_per_day: round(v.viewsPerDay, 0),
    })),
    news: news.map((n, index) => ({
      index,
      headline: n.title,
      source: n.source,
      date: n.publishedAt ? day(n.publishedAt) : null,
      link: n.link,
    })),
  };
}

// ---- Output ----

const text = z.string().min(1).max(1200);
export const writtenThemeSchema = z.object({
  slug: z.string(),
  momentum: z.string(),
  confidence: z.string(),
  why_this_week: text,
  youtube_evidence: text,
  news_index: z.number().int().nullable(),
  outside_context: text,
  interpretation: text,
  filming_angle: text,
  uncertain: text,
});
export type WrittenTheme = z.infer<typeof writtenThemeSchema>;

export const writeOutputSchema = z.object({
  executive_summary: z.string().min(1).max(1500),
  top_opportunities: z.array(z.object({ slug: z.string(), reason: z.string().min(1).max(400) })).min(1).max(3),
  themes: z.array(writtenThemeSchema).min(1).max(5),
});
export type WriteOutput = z.infer<typeof writeOutputSchema>;

const s = (description: string): Schema => ({ type: Type.STRING, description });
export const writeResponseSchema: Schema = {
  type: Type.OBJECT,
  properties: {
    executive_summary: s("2 to 4 sentences for the whole week"),
    top_opportunities: {
      type: Type.ARRAY,
      minItems: "1",
      maxItems: "3",
      items: {
        type: Type.OBJECT,
        properties: { slug: s("slug of one theme"), reason: s("one sentence") },
        required: ["slug", "reason"],
      },
    },
    themes: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          slug: s("copied from the evidence"),
          momentum: s("copied exactly from the evidence"),
          confidence: s("copied exactly from the evidence"),
          why_this_week: s("why the timing matters this week, from the evidence"),
          youtube_evidence: s("what the measured YouTube numbers show"),
          news_index: { type: Type.INTEGER, nullable: true, description: "index of the news item used, or null" },
          outside_context: s(`what the chosen news item adds, or exactly "${NO_NEWS}"`),
          interpretation: s("your interpretation, clearly an opinion, not a fact"),
          filming_angle: s("one specific video idea for an Indian tech audience"),
          uncertain: s("what the data cannot tell us"),
        },
        required: [
          "slug", "momentum", "confidence", "why_this_week", "youtube_evidence",
          "news_index", "outside_context", "interpretation", "filming_angle", "uncertain",
        ],
        propertyOrdering: [
          "slug", "momentum", "confidence", "why_this_week", "youtube_evidence",
          "news_index", "outside_context", "interpretation", "filming_angle", "uncertain",
        ],
      },
    },
  },
  required: ["executive_summary", "top_opportunities", "themes"],
  propertyOrdering: ["executive_summary", "top_opportunities", "themes"],
};

export const WRITE_SYSTEM = [
  "You write a Sunday content brief for Ishaan, who runs a tech YouTube channel for Indian audiences.",
  "Rules:",
  "- Use only the numbers, dates, links, titles and headlines in the evidence. Never compute new numbers, never estimate, never add numbers from your own knowledge.",
  "- You may round a number, but write it in digits (for example 139k or 2.95x). Do not convert units.",
  "- Copy momentum and confidence exactly. Never describe a trend direction that differs from momentum:",
  "  'established' means popular now with no measured acceleration; 'insufficient_evidence' means the data cannot say; only 'rising' may be called rising or growing; only 'fading' may be called fading or declining.",
  "- Do not claim one thing caused another. A news story happening at the same time is context, not proof.",
  `- outside_context: if a news item is relevant, set news_index to its index and explain what it adds. If none is relevant or none is given, set news_index to null and outside_context to exactly "${NO_NEWS}"`,
  "- interpretation is your opinion. Start it with 'Interpretation:'.",
  "- filming_angle: one concrete video idea for an Indian tech audience, not a generic title.",
  "- uncertain: say honestly what the data cannot establish (sample size, no history, missing data).",
  "- Write one entry per theme, in the given order, with the given slugs. Do not use em dashes.",
].join("\n");

export function buildWritePrompt(evidence: ThemeEvidence[], weekId: string, retryErrors: string[] = []): string {
  const parts = [`Week: ${weekId}`, "Evidence (JSON):", JSON.stringify({ themes: evidence }, null, 1)];
  if (retryErrors.length > 0) {
    parts.push(
      "",
      "Your previous answer failed these checks. Fix them and return the full answer again:",
      ...retryErrors.map((e) => `- ${e}`),
    );
  }
  return parts.join("\n");
}
