import "server-only";
import { db } from "./db";
import type { CollectedVideo, Snapshot } from "./collector";
import type { SnapshotPoint } from "./momentum";
import type { VideoInput } from "./scorer";
import type { LlmLog } from "./gemini";
import type { StoredPastTheme } from "./theme-gate";
import type { Settings } from "./types";

// Database reads and writes for collection (map steps 5 and 6).
// Rows are sent as one JSON parameter and unpacked in SQL, so each write is a
// single statement and values are never pasted into the SQL text.

export async function loadSettings(): Promise<Settings> {
  const rows = await db()`
    select categories, keywords, region_code, relevance_language, category_ids, email
    from settings where id = 1`;
  if (rows.length === 0) throw new Error("Settings row is missing. Apply db/migrations/0001_init.sql.");
  const r = rows[0];
  return {
    categories: r.categories,
    keywords: r.keywords,
    regionCode: r.region_code,
    relevanceLanguage: r.relevance_language,
    categoryIds: r.category_ids,
    email: r.email,
  };
}

// Videos from themes in roughly the last two weeks that are still available.
// Refreshing their stats is what lets momentum compare two snapshots.
export async function loadTrackedVideoIds(): Promise<string[]> {
  const rows = await db()`
    select distinct v.video_id
    from themes t
    join runs r on r.id = t.run_id
    cross join lateral unnest(t.video_ids) as tv(video_id)
    join videos v on v.video_id = tv.video_id
    where r.started_at > now() - interval '15 days' and not v.unavailable`;
  return rows.map((r) => r.video_id as string);
}

// Insert new videos, refresh details of known ones. A video seen again is available again.
export async function upsertVideos(videos: CollectedVideo[], seenAt: string): Promise<void> {
  if (videos.length === 0) return;
  const rows = videos.map((v) => ({
    video_id: v.videoId,
    channel_id: v.channelId,
    channel_title: v.channelTitle,
    title: v.title,
    published_at: v.publishedAt,
    duration_sec: v.durationSec,
    tags: v.tags,
    category_id: v.categoryId,
  }));
  await db()`
    insert into videos (video_id, channel_id, channel_title, title, published_at, duration_sec,
                        tags, category_id, first_seen_at, last_seen_at, unavailable)
    select video_id, channel_id, channel_title, title, published_at, duration_sec,
           tags, category_id, ${seenAt}::timestamptz, ${seenAt}::timestamptz, false
    from jsonb_to_recordset(${JSON.stringify(rows)}::jsonb) as r(
      video_id text, channel_id text, channel_title text, title text, published_at timestamptz,
      duration_sec int, tags text[], category_id text)
    on conflict (video_id) do update set
      channel_title = excluded.channel_title,
      title = excluded.title,
      duration_sec = excluded.duration_sec,
      tags = excluded.tags,
      category_id = excluded.category_id,
      last_seen_at = excluded.last_seen_at,
      unavailable = false`;
}

// Append-only: an existing snapshot for the same video and day is never overwritten.
// Returns how many new rows were written.
export async function insertSnapshots(snapshots: Snapshot[], runId: string): Promise<number> {
  if (snapshots.length === 0) return 0;
  const rows = snapshots.map((s) => ({
    video_id: s.videoId,
    observed_at: s.observedAt,
    observed_on: s.observedOn,
    views: s.views,
    likes: s.likes,
    comments: s.comments,
    channel_subscribers: s.channelSubscribers,
  }));
  const inserted = await db()`
    insert into video_snapshots (video_id, observed_at, observed_on, run_id, views, likes, comments, channel_subscribers)
    select video_id, observed_at, observed_on, ${runId}::uuid, views, likes, comments, channel_subscribers
    from jsonb_to_recordset(${JSON.stringify(rows)}::jsonb) as r(
      video_id text, observed_at timestamptz, observed_on date, views bigint,
      likes bigint, comments bigint, channel_subscribers bigint)
    on conflict (video_id, observed_on) do nothing
    returning video_id`;
  return inserted.length;
}

// Every video snapshotted by a run, with that run's numbers, ready for the Scorer.
export async function loadRunVideos(runId: string): Promise<VideoInput[]> {
  const rows = await db()`
    select v.video_id, v.channel_id, v.channel_title, v.title, v.published_at, v.duration_sec, v.tags,
           s.views, s.likes, s.comments
    from video_snapshots s join videos v on v.video_id = s.video_id
    where s.run_id = ${runId}`;
  return rows.map((r) => ({
    videoId: r.video_id,
    channelId: r.channel_id,
    channelTitle: r.channel_title,
    title: r.title,
    publishedAt: new Date(r.published_at).toISOString(),
    durationSec: r.duration_sec,
    tags: r.tags,
    views: r.views === null ? null : Number(r.views),
    likes: r.likes === null ? null : Number(r.likes),
    comments: r.comments === null ? null : Number(r.comments),
  }));
}

// All stored snapshots for these videos, oldest first, for momentum.
export async function loadSnapshotHistories(videoIds: string[]): Promise<Map<string, SnapshotPoint[]>> {
  const out = new Map<string, SnapshotPoint[]>();
  if (videoIds.length === 0) return out;
  const rows = await db()`
    select video_id, observed_at, views from video_snapshots
    where video_id = any(${videoIds}::text[]) order by observed_at`;
  for (const r of rows) {
    const list = out.get(r.video_id) ?? [];
    list.push({ observedAt: new Date(r.observed_at).toISOString(), views: Number(r.views) });
    out.set(r.video_id, list);
  }
  return out;
}

// Themes from earlier real weeks (ISO week IDs only, so manual test runs never count),
// for the "New this week" / "Recurring since" label and momentum comparison.
export async function loadPastThemes(beforeWeekId: string): Promise<StoredPastTheme[]> {
  const rows = await db()`
    select week_id, slug, name, recurring_from_week, metrics
    from themes
    where week_id ~ '^[0-9]{4}-W[0-9]{2}$' and week_id < ${beforeWeekId}
    order by week_id desc
    limit 40`;
  return rows.map((r) => ({
    weekId: r.week_id,
    slug: r.slug,
    name: r.name,
    recurringFromWeek: r.recurring_from_week,
    creatorCount: Number(r.metrics?.creatorCount ?? 0),
    recentUploadCount: Number(r.metrics?.recentUploadCount ?? 0),
  }));
}

export async function insertLlmLogs(runId: string, logs: LlmLog[]): Promise<void> {
  for (const l of logs) {
    await db()`
      insert into llm_logs (run_id, task, model, attempt, tokens_in, tokens_out, ok, error)
      values (${runId}, ${l.task}, ${l.model}, ${l.attempt}, ${l.tokensIn}, ${l.tokensOut}, ${l.ok}, ${l.error})`;
  }
}

// Flag videos that no longer come back from the API. Their history is kept.
export async function markUnavailable(videoIds: string[]): Promise<number> {
  if (videoIds.length === 0) return 0;
  const updated = await db()`
    update videos set unavailable = true
    where video_id = any(${videoIds}::text[]) and not unavailable
    returning video_id`;
  return updated.length;
}
