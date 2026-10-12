import { z } from "zod";
import { slugify } from "./config/keywords";

// The "Start research" form (research briefs, run from the website). Pure code, so it is tested.

export const REGIONS = [
  { code: "IN", label: "India" },
  { code: "US", label: "United States" },
  { code: "GB", label: "United Kingdom" },
  { code: "CA", label: "Canada" },
  { code: "AU", label: "Australia" },
] as const;

// YouTube video categories used for the "trending" part of collection. 0 = no category filter.
export const CATEGORIES = [
  { id: 28, label: "Science & Technology" },
  { id: 20, label: "Gaming" },
  { id: 27, label: "Education" },
  { id: 24, label: "Entertainment" },
  { id: 0, label: "All categories" },
] as const;

export const MAX_RESEARCH_KEYWORDS = 5;

export type ResearchInput = { topic: string; keywords: string[]; regionCode: string; categoryIds: number[] };

const schema = z.object({
  topic: z.string().min(3, "Topic needs at least 3 characters").max(80, "Topic can be at most 80 characters"),
  keywords: z.array(z.string().max(60, "Each keyword can be at most 60 characters")).min(1).max(MAX_RESEARCH_KEYWORDS, `At most ${MAX_RESEARCH_KEYWORDS} keywords`),
  regionCode: z.enum(REGIONS.map((r) => r.code) as [string, ...string[]], { message: "Pick a region from the list" }),
  categoryId: z.number().refine((n) => CATEGORIES.some((c) => c.id === n), "Pick a category from the list"),
});

// With no keywords given, the topic itself plus two common phrasings are searched.
export function defaultKeywords(topic: string): string[] {
  return [topic, `${topic} news`, `${topic} explained`];
}

export function parseResearchForm(form: {
  topic?: string;
  keywords?: string;
  regionCode?: string;
  categoryId?: string | number;
}): { ok: true; input: ResearchInput } | { ok: false; errors: string[] } {
  const topic = (form.topic ?? "").trim().replace(/\s+/g, " ");
  const typed = [...new Set((form.keywords ?? "").split(/[\n,]+/).map((k) => k.trim()).filter(Boolean))];
  const result = schema.safeParse({
    topic,
    keywords: typed.length > 0 ? typed : defaultKeywords(topic),
    regionCode: (form.regionCode ?? "").trim().toUpperCase(),
    categoryId: Number(form.categoryId ?? 0),
  });
  if (!result.success) return { ok: false, errors: [...new Set(result.error.issues.map((i) => i.message))] };
  const { categoryId, ...rest } = result.data;
  return { ok: true, input: { ...rest, categoryIds: categoryId === 0 ? [] : [categoryId] } };
}

// e.g. research-ps5-jailbreak-20261012-1830 (UTC). Unique per minute, readable in the archive.
export function researchLabel(topic: string, now: Date): string {
  const stamp = now.toISOString().slice(0, 16).replace(/[-:]/g, "").replace("T", "-");
  return `research-${slugify(topic).slice(0, 40) || "topic"}-${stamp}`;
}

// YouTube's search bucket resets at midnight Pacific Time, which is Saturday evening in India,
// so research on the same Pacific day as the Sunday run must leave room for it.
export const SUNDAY_SEARCH_RESERVE = 20;

export function searchBudgetCheck(usedToday: number, planned: number, dailyLimit: number): string | null {
  const left = dailyLimit - usedToday - planned;
  if (left >= SUNDAY_SEARCH_RESERVE) return null;
  return `Not enough YouTube search quota left today: ${usedToday} of ${dailyLimit} searches used, this research needs ${planned}, and ${SUNDAY_SEARCH_RESERVE} are kept for the Sunday brief. Try again after the quota resets (12:30 or 13:30 IST).`;
}
