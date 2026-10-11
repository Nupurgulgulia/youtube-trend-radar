import { assembleBrief, limitationsFor, type BriefContent, type Coverage } from "./brief";
import { selectCandidates } from "./cluster";
import type { SourceReport } from "./collector";
import type { GenerateFn, LlmLog } from "./gemini";
import type { NewsItem } from "./news";
import { matchNews } from "./news-match";
import type { SnapshotPoint } from "./momentum";
import { decideOutcome, runPublishGate, type Outcome, type PublishResult } from "./publish-gate";
import { scoreVideos, type VideoInput } from "./scorer";
import { distinct } from "./stats";
import { runThemeGate, type GateResult, type StoredPastTheme } from "./theme-gate";
import type { Settings } from "./types";
import { buildEvidence } from "./write";

// Steps 7 to 11 in order: score, cluster + Theme Gate, match news, write + Publish Gate,
// decide the outcome, assemble the brief. Shared by the run route and the test scripts.
// At most 4 Gemini calls: 2 for clustering, 2 for writing.

export type AnalyseInput = {
  weekId: string;
  observedAt: string;
  settings: Settings;
  videos: VideoInput[];
  histories: Map<string, SnapshotPoint[]>;
  pastThemes: StoredPastTheme[];
  keywordNews: NewsItem[]; // headlines fetched per keyword by the collector
  fetchNews: (query: string) => Promise<NewsItem[]>; // for per-theme headlines
  generate: GenerateFn;
  model: string;
  coverage: { sources: SourceReport | null; keywordsSearched: string[]; keywordsSkipped: { keyword: string; reason: string }[]; quotaUsed: number | null; quotaEstimated: number | null; searchCalls: number | null };
  now?: () => Date;
};

export type AnalyseResult = {
  outcome: Outcome;
  brief: BriefContent | null;
  gate: GateResult;
  publish: PublishResult | null;
  logs: LlmLog[];
  failure: string | null;
  newsErrors: string[];
  timings: Record<string, number>;
};

export async function analyse(input: AnalyseInput): Promise<AnalyseResult> {
  const now = input.now ?? (() => new Date());
  const timings: Record<string, number> = {};
  const timed = async <T,>(stage: string, fn: () => Promise<T>): Promise<T> => {
    const t0 = Date.now();
    try {
      return await fn();
    } finally {
      timings[stage] = Date.now() - t0;
    }
  };

  const scored = scoreVideos(input.videos, input.observedAt);
  const videosById = new Map(scored.map((v) => [v.videoId, v]));
  const firstRun = input.pastThemes.length === 0 && [...input.histories.values()].every((h) => h.length < 2);

  // Steps 8 and 9.
  const gate = await timed("cluster_ms", () =>
    runThemeGate({
      generate: input.generate,
      model: input.model,
      settings: input.settings,
      candidates: selectCandidates(scored),
      allVideos: scored,
      histories: input.histories,
      pastThemes: input.pastThemes,
      observedAt: input.observedAt,
    }),
  );

  const outcome = decideOutcome(false, gate.themes.length);
  if (outcome === "failed") {
    return { outcome, brief: null, gate, publish: null, logs: gate.logs, failure: gate.failure, newsErrors: [], timings };
  }

  // News per theme: the theme name as a query, pooled with the keyword headlines. Never fatal.
  const newsErrors: string[] = [];
  const newsByTheme = new Map<string, NewsItem[]>();
  await timed("news_ms", async () => {
    for (const t of gate.themes) {
      let own: NewsItem[] = [];
      try {
        own = await input.fetchNews(t.name);
      } catch (e) {
        newsErrors.push(`news for '${t.slug}': ${e instanceof Error ? e.message : "failed"}`);
      }
      newsByTheme.set(t.slug, matchNews(t.name, [...own, ...input.keywordNews]));
    }
  });

  // Steps 10 and 11.
  const evidence = gate.themes.map((t) => buildEvidence(t, videosById, newsByTheme.get(t.slug) ?? []));
  const publish = await timed("write_ms", () =>
    runPublishGate({ generate: input.generate, model: input.model, weekId: input.weekId, evidence }),
  );

  const coverage: Coverage = {
    videosScanned: scored.length,
    creators: distinct(scored.map((v) => v.channelId)),
    keywordsSearched: input.coverage.keywordsSearched,
    keywordsSkipped: input.coverage.keywordsSkipped,
    sources: input.coverage.sources,
    quotaUsed: input.coverage.quotaUsed,
    quotaEstimated: input.coverage.quotaEstimated,
    searchCalls: input.coverage.searchCalls,
    firstRun,
    droppedThemes: gate.dropped,
    limitations: limitationsFor(scored, firstRun, input.coverage.sources),
  };

  const brief = assembleBrief({
    weekId: input.weekId,
    status: outcome,
    generatedAt: now().toISOString(),
    themes: gate.themes,
    evidence,
    newsByTheme,
    publish,
    coverage,
  });

  return { outcome, brief, gate, publish, logs: [...gate.logs, ...publish.logs], failure: null, newsErrors, timings };
}
