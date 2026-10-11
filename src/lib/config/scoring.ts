// Scoring thresholds (map step 7). Every number here is a starting assumption to
// tune, not a fact. They are deliberately conservative. See docs/scoring.md.

// ---- Per-video metrics ----

// Videos younger than this are treated as this old, so a 1-hour-old video
// does not get an absurd views-per-day figure.
export const MIN_AGE_DAYS = 0.5;

// Engagement is only computed when a video has at least this many views.
// Below it, a handful of likes swings the rate too much to mean anything.
export const MIN_VIEWS_FOR_ENGAGEMENT = 1000;

// Age bands. A video is compared only with videos in the same band, because
// young videos naturally have higher views per day. Upper bounds are exclusive.
export const AGE_BANDS = [
  { band: "0-2 days", belowDays: 3 },
  { band: "3-7 days", belowDays: 8 },
  { band: "8-14 days", belowDays: 15 },
  { band: "15+ days", belowDays: Infinity },
] as const;

// Length buckets, by duration in seconds (upper bounds inclusive).
export const LENGTH_BUCKETS = [
  { bucket: "short", maxSec: 180 }, // 3 minutes or less
  { bucket: "mid", maxSec: 600 }, // over 3, up to 10 minutes
  { bucket: "long", maxSec: 1200 }, // over 10, up to 20 minutes
  { bucket: "deep", maxSec: Infinity }, // over 20 minutes
] as const;

// ---- Snapshot comparison ----

// Two snapshots of the same video must be at least this far apart before the
// views gained between them are used. Closer snapshots are too noisy.
export const MIN_SNAPSHOT_GAP_DAYS = 5;

// A theme needs this many videos with comparable history before rising or fading
// can be considered at all.
export const MIN_TRACKED_VIDEOS = 3;

// Rising: median views gained per day is at least this multiple of the previous interval.
export const RISING_RATIO = 1.25;

// Fading: median views gained per day is at or below this multiple of the previous interval.
export const FADING_RATIO = 0.75;

// ---- Theme support ----

// Below these, a theme is insufficient_evidence no matter what.
export const MIN_THEME_VIDEOS = 3;
export const MIN_THEME_CREATORS = 2;

// Share of a theme's videos that must have a view count. Below it, metrics are "missing".
export const MIN_VIEW_COVERAGE = 0.8;

// Established: at least this many distinct creators...
export const ESTABLISHED_MIN_CREATORS = 3;
// ...and a median "band index" at or above this. A band index of 1.0 means views per
// day equal to the typical (median) video of the same age in this run.
export const STRONG_BAND_INDEX = 1.0;

// Videos published within this many days of the observation count as "new uploads".
export const RECENT_UPLOAD_DAYS = 7;

// ---- Format and length findings ----

// A group may be compared with another only with at least this many videos...
export const MIN_FORMAT_SAMPLE = 5;
// ...from at least this many distinct creators.
export const MIN_FORMAT_CREATORS = 3;

export const SAMPLE_TOO_SMALL = "Sample too small to compare";

// ---- Confidence (one point each, see docs/scoring.md) ----

export const CONFIDENCE_VIDEOS_POINT = 8; // at least this many videos
export const CONFIDENCE_CREATORS_POINT = 5; // at least this many distinct creators
export const CONFIDENCE_ENGAGEMENT_COVERAGE = 0.7; // share of videos with an engagement rate
