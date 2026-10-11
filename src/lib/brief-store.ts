import "server-only";
import type { AnalyseResult } from "./analyse";
import type { BriefContent } from "./brief";
import { db } from "./db";
import type { Settings } from "./types";

// Reads and writes for the brief page, archive, decisions and settings (map steps 1, 12, 14).

export type Decision = "film" | "skip" | "investigate";
export type BriefRow = { weekId: string; status: string; publishedAt: string; content: BriefContent };

export const isRealWeek = (weekId: string) => /^\d{4}-W\d{2}$/.test(weekId);

const toRow = (r: Record<string, unknown>): BriefRow => ({
  weekId: r.week_id as string,
  status: r.status as string,
  publishedAt: new Date(r.published_at as string).toISOString(),
  content: r.content as BriefContent,
});

// Latest real week first; test previews only if no real brief exists yet.
export async function loadLatestBrief(): Promise<BriefRow | null> {
  const rows = await db()`
    select week_id, status, published_at, content from briefs
    order by (week_id ~ '^[0-9]{4}-W[0-9]{2}$') desc, published_at desc limit 1`;
  return rows[0] ? toRow(rows[0]) : null;
}

export async function loadBrief(weekId: string): Promise<BriefRow | null> {
  const rows = await db()`select week_id, status, published_at, content from briefs where week_id = ${weekId}`;
  return rows[0] ? toRow(rows[0]) : null;
}

export async function listBriefs(): Promise<{ weekId: string; status: string; publishedAt: string; themeCount: number }[]> {
  const rows = await db()`
    select week_id, status, published_at, jsonb_array_length(content->'themes') as theme_count
    from briefs order by published_at desc`;
  return rows.map((r) => ({
    weekId: r.week_id,
    status: r.status,
    publishedAt: new Date(r.published_at).toISOString(),
    themeCount: Number(r.theme_count),
  }));
}

// Saves the brief and its themes. Upserts, so a retried save never duplicates rows.
export async function saveBrief(runId: string, weekId: string, result: AnalyseResult): Promise<void> {
  const brief = result.brief;
  if (!brief) throw new Error("saveBrief: there is no brief to save");
  for (const [i, t] of result.gate.themes.entries()) {
    const bt = brief.themes[i];
    await db()`
      insert into themes (run_id, week_id, slug, name, momentum, confidence, video_ids, metrics,
                          format_findings, news, written, is_new, recurring_from_week)
      values (${runId}, ${weekId}, ${t.slug}, ${t.name}, ${t.metrics.momentum}, ${t.metrics.confidence},
              ${t.videoIds}, ${JSON.stringify(t.metrics)}::jsonb, ${JSON.stringify(t.metrics.findings)}::jsonb,
              ${JSON.stringify(bt.news)}::jsonb, ${bt.written ? JSON.stringify(bt.written) : null}::jsonb,
              ${t.isNew}, ${t.recurringFromWeek})
      on conflict (week_id, slug) do update set
        run_id = excluded.run_id, name = excluded.name, momentum = excluded.momentum,
        confidence = excluded.confidence, video_ids = excluded.video_ids, metrics = excluded.metrics,
        format_findings = excluded.format_findings, news = excluded.news, written = excluded.written,
        is_new = excluded.is_new, recurring_from_week = excluded.recurring_from_week`;
  }
  await db()`
    insert into briefs (week_id, run_id, status, content, published_at)
    values (${weekId}, ${runId}, ${brief.status}, ${JSON.stringify(brief)}::jsonb, now())
    on conflict (week_id) do update set
      run_id = excluded.run_id, status = excluded.status, content = excluded.content, published_at = now()`;
}

export async function loadDecisions(weekId: string): Promise<Map<string, { decision: Decision; note: string | null }>> {
  const rows = await db()`select theme_slug, decision, note from decisions where week_id = ${weekId}`;
  return new Map(rows.map((r) => [r.theme_slug as string, { decision: r.decision as Decision, note: r.note as string | null }]));
}

// The most recent earlier decision for each slug, shown as "Last time you chose".
export async function loadPreviousDecisions(weekId: string, slugs: string[]): Promise<Map<string, { decision: Decision; weekId: string }>> {
  if (slugs.length === 0) return new Map();
  const rows = await db()`
    select distinct on (theme_slug) theme_slug, decision, week_id from decisions
    where theme_slug = any(${slugs}::text[]) and week_id < ${weekId} and week_id ~ '^[0-9]{4}-W[0-9]{2}$'
    order by theme_slug, week_id desc`;
  return new Map(rows.map((r) => [r.theme_slug as string, { decision: r.decision as Decision, weekId: r.week_id as string }]));
}

export async function saveDecision(weekId: string, slug: string, decision: Decision, note: string | null): Promise<void> {
  await db()`
    insert into decisions (week_id, theme_slug, decision, note, decided_at)
    values (${weekId}, ${slug}, ${decision}, ${note}, now())
    on conflict (week_id, theme_slug) do update set decision = excluded.decision, note = excluded.note, decided_at = now()`;
}

export async function saveSettings(s: Settings): Promise<void> {
  await db()`
    update settings set
      categories = ${s.categories}, keywords = ${s.keywords}, region_code = ${s.regionCode},
      relevance_language = ${s.relevanceLanguage}, category_ids = ${s.categoryIds}, email = ${s.email},
      updated_at = now()
    where id = 1`;
}
