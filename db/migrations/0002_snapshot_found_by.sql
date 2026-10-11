-- Which sources surfaced each video in a run, e.g. {"trending:28","search:AI tools"}.
-- Used to give every keyword a fair share of the videos Gemini sees (map step 8).
-- Older rows get an empty list. Nothing else changes.
alter table video_snapshots add column found_by text[] not null default '{}';
