import "server-only";
import { db } from "./db";
import type { CollectedVideo, Snapshot } from "./collector";
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

// Flag videos that no longer come back from the API. Their history is kept.
export async function markUnavailable(videoIds: string[]): Promise<number> {
  if (videoIds.length === 0) return 0;
  const updated = await db()`
    update videos set unavailable = true
    where video_id = any(${videoIds}::text[]) and not unavailable
    returning video_id`;
  return updated.length;
}
