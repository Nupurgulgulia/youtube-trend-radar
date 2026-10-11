import type { Schema } from "@google/genai";
import { buildClusterPrompt, CLUSTER_SYSTEM, clusterOutputSchema, clusterResponseSchema, type ProposedTheme } from "./cluster";
import { keywords, slugify } from "./config/keywords";
import { MIN_THEME_CREATORS, MIN_THEME_VIDEOS } from "./config/scoring";
import { generateJson, type GenerateFn, type LlmLog } from "./gemini";
import type { PastTheme, SnapshotPoint } from "./momentum";
import type { ScoredVideo } from "./scorer";
import { themeMetrics, type ThemeMetrics } from "./theme-metrics";
import type { Settings } from "./types";

// Theme Gate (map step 9). Code checks every theme Gemini proposed. One retry with a
// specific error list, then failing themes are dropped. The rules are never relaxed.

// Share of a theme's videos that must share a significant keyword with the theme name
// or with another video in the theme.
export const COHERENCE_MIN_SHARE = 0.6;
// Past-theme match: share of name keywords in common (overlap / smaller set).
export const PAST_THEME_KEYWORD_OVERLAP = 0.5;
export const MAX_THEMES = 5;

export const youtubeLink = (id: string) => `https://www.youtube.com/watch?v=${id}`;

export type StoredPastTheme = {
  weekId: string;
  slug: string;
  name: string;
  recurringFromWeek: string | null;
  creatorCount: number;
  recentUploadCount: number;
};

export type GatedTheme = {
  name: string;
  slug: string;
  reason: string;
  videoIds: string[];
  links: string[];
  metrics: ThemeMetrics;
  isNew: boolean;
  recurringFromWeek: string | null;
};

export type ThemeCheck = { theme: ProposedTheme; errors: string[] };

// ---- Individual checks ----

export function checkThemes(themes: ProposedTheme[], videosById: Map<string, ScoredVideo>): ThemeCheck[] {
  const claimedBy = new Map<string, string>(); // video ID -> slug of the first theme that used it
  return themes.map((t) => {
    const slug = slugify(t.slug || t.name);
    const errors: string[] = [];
    const ids = [...new Set(t.video_ids)];

    const missing = ids.filter((id) => !videosById.has(id));
    for (const id of missing) errors.push(`theme '${slug}': video ${id} not in dataset`);

    const real = ids.filter((id) => videosById.has(id));
    for (const id of real) {
      const owner = claimedBy.get(id);
      if (owner) errors.push(`theme '${slug}': video ${id} is already in theme '${owner}'`);
      else claimedBy.set(id, slug);
    }

    const vids = real.map((id) => videosById.get(id)!);
    const creators = new Set(vids.map((v) => v.channelId)).size;
    if (vids.length < MIN_THEME_VIDEOS) {
      errors.push(`theme '${slug}': only ${vids.length} valid videos (need ${MIN_THEME_VIDEOS})`);
    }
    if (creators < MIN_THEME_CREATORS) {
      errors.push(`theme '${slug}': only ${creators} distinct creator (need ${MIN_THEME_CREATORS})`);
    }

    const share = coherenceShare(t.name, vids);
    if (vids.length > 0 && share < COHERENCE_MIN_SHARE) {
      errors.push(
        `theme '${slug}': only ${Math.round(share * 100)}% of videos share a keyword with the theme name or each other (need ${COHERENCE_MIN_SHARE * 100}%)`,
      );
    }
    return { theme: { ...t, slug, video_ids: ids }, errors };
  });
}

// A video is coherent if its title and tags share a significant keyword with the theme
// name, or with at least one other video in the theme.
export function coherenceShare(name: string, videos: ScoredVideo[]): number {
  if (videos.length === 0) return 0;
  const nameWords = keywords(name);
  const words = videos.map((v) => keywords(`${v.title} ${v.tags.join(" ")}`));
  const coherent = words.filter((w, i) => {
    if ([...w].some((k) => nameWords.has(k))) return true;
    return words.some((other, j) => j !== i && [...w].some((k) => other.has(k)));
  });
  return coherent.length / videos.length;
}

// Most recent past theme with the same slug, or enough shared name keywords.
export function matchPastTheme(name: string, slug: string, past: StoredPastTheme[]): StoredPastTheme | null {
  const nameWords = keywords(name);
  const sorted = [...past].sort((a, b) => b.weekId.localeCompare(a.weekId));
  for (const p of sorted) {
    if (p.slug === slug) return p;
    const pw = keywords(p.name);
    const common = [...nameWords].filter((k) => pw.has(k)).length;
    const smaller = Math.min(nameWords.size, pw.size);
    if (smaller > 0 && common / smaller >= PAST_THEME_KEYWORD_OVERLAP) return p;
  }
  return null;
}

// ---- The full step: cluster, check, one retry, drop ----

export type GateDeps = {
  generate: GenerateFn;
  model: string;
  settings: Settings;
  candidates: ScoredVideo[]; // what Gemini is shown
  allVideos: ScoredVideo[]; // every video collected in this run
  histories: Map<string, SnapshotPoint[]>;
  pastThemes: StoredPastTheme[];
  observedAt: string;
};

export type GateResult = {
  themes: GatedTheme[];
  dropped: { name: string; errors: string[] }[];
  logs: LlmLog[];
  failure: string | null; // set when no theme survived, with the reason
};

export async function runThemeGate(deps: GateDeps): Promise<GateResult> {
  const videosById = new Map(deps.allVideos.map((v) => [v.videoId, v]));
  const logs: LlmLog[] = [];

  const ask = async (attempt: number, retryErrors: string[]) => {
    const res = await generateJson(
      deps.generate,
      { task: "cluster", model: deps.model, attempt },
      {
        system: CLUSTER_SYSTEM,
        prompt: buildClusterPrompt(deps.candidates, deps.settings, retryErrors),
        schema: clusterResponseSchema as Schema,
      },
      clusterOutputSchema,
    );
    logs.push(res.log);
    return res;
  };

  // Attempt 1.
  const first = await ask(1, []);
  let checks: ThemeCheck[] = first.ok ? checkThemes(first.data.themes, videosById) : [];
  const firstErrors = first.ok ? checks.flatMap((c) => c.errors) : [first.error];

  // One retry, only if something failed.
  if (firstErrors.length > 0) {
    const second = await ask(2, firstErrors);
    if (second.ok) checks = checkThemes(second.data.themes, videosById);
    // If the retry itself was unusable, keep whatever passed on the first attempt.
  }

  const passed = checks.filter((c) => c.errors.length === 0).slice(0, MAX_THEMES);
  const dropped = checks.filter((c) => c.errors.length > 0).map((c) => ({ name: c.theme.name, errors: c.errors }));

  const themes = passed.map(({ theme }) => {
    const vids = theme.video_ids.map((id) => videosById.get(id)!);
    const match = matchPastTheme(theme.name, theme.slug, deps.pastThemes);
    const pastTheme: PastTheme | null = match
      ? { weekId: match.weekId, creatorCount: match.creatorCount, recentUploadCount: match.recentUploadCount }
      : null;
    return {
      name: theme.name,
      slug: theme.slug,
      reason: theme.reason,
      videoIds: theme.video_ids,
      links: theme.video_ids.map(youtubeLink),
      // Recomputed here from stored records, never taken from Gemini.
      metrics: themeMetrics(vids, deps.histories, pastTheme, deps.observedAt),
      isNew: match === null,
      recurringFromWeek: match ? (match.recurringFromWeek ?? match.weekId) : null,
    };
  });

  const lastError = logs.at(-1)?.error;
  return {
    themes,
    dropped,
    logs,
    failure:
      themes.length > 0
        ? null
        : checks.length === 0
          ? `Gemini did not return usable themes: ${lastError ?? "unknown error"}`
          : "Every proposed theme failed the Theme Gate after one retry",
  };
}
