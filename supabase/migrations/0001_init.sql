-- YouTube Trend Radar: initial schema (map step 5, Supabase memory).
-- Retries must never duplicate rows, and older snapshots are never overwritten.
-- RLS is on for every table with no policies: only the server (service-role key) can read or write.

-- 1. Settings: a single row that Ishaan edits on the Settings page.
create table settings (
  id int primary key default 1 check (id = 1),
  categories text[] not null default '{}',
  keywords text[] not null default '{}',
  region_code text not null default 'IN',
  relevance_language text not null default 'en',
  category_ids int[] not null default '{}',
  email text not null default '',
  updated_at timestamptz not null default now()
);

-- Starting values for Ishaan's channel. These are editable defaults, not data.
-- 28 is assumed to be YouTube's "Science & Technology" category; confirm with videoCategories.list.
insert into settings (id, categories, keywords, region_code, relevance_language, category_ids)
values (
  1,
  array['AI tools', 'Productivity apps', 'Tech reviews'],
  array['AI tools', 'AI coding', 'ChatGPT', 'productivity apps', 'smartphone review', 'laptop review'],
  'IN',
  'en',
  array[28]
);

-- 15. Run archive: one row per ISO week. The unique week_id is the lock against duplicate runs.
create table runs (
  id uuid primary key default gen_random_uuid(),
  week_id text not null unique,
  status text not null check (status in ('running', 'succeeded', 'thin', 'failed')),
  attempt int not null default 1,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  error text,
  source_report jsonb not null default '{}',
  stage_timings jsonb not null default '{}',
  quota_estimated int,
  quota_used int not null default 0,
  tokens_in int not null default 0,
  tokens_out int not null default 0,
  email_sent_at timestamptz
);

-- Videos seen by any run. A deleted or private video is flagged, never removed.
create table videos (
  video_id text primary key,
  channel_id text not null,
  channel_title text not null,
  title text not null,
  published_at timestamptz not null,
  duration_sec int,
  tags text[] not null default '{}',
  category_id text,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  unavailable boolean not null default false
);

-- Dated, append-only statistics. Insert with "on conflict do nothing".
-- null means "not available", which is different from zero.
create table video_snapshots (
  video_id text not null references videos (video_id),
  observed_at timestamptz not null,
  observed_on date not null,
  run_id uuid not null references runs (id),
  views bigint not null,
  likes bigint,
  comments bigint,
  channel_subscribers bigint,
  primary key (video_id, observed_on)
);

-- Themes that passed the Theme Gate, one set per week.
create table themes (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references runs (id),
  week_id text not null,
  slug text not null,
  name text not null,
  momentum text not null check (momentum in ('rising', 'established', 'fading', 'insufficient_evidence')),
  confidence text not null check (confidence in ('high', 'medium', 'low')),
  video_ids text[] not null,
  metrics jsonb not null,
  format_findings jsonb not null,
  news jsonb not null default '[]',
  written jsonb,
  is_new boolean not null,
  recurring_from_week text,
  unique (week_id, slug)
);

-- The published brief for each week.
create table briefs (
  week_id text primary key,
  run_id uuid not null references runs (id),
  status text not null check (status in ('succeeded', 'thin')),
  content jsonb not null,
  published_at timestamptz not null default now()
);

-- 14. Ishaan's decision per theme (human checkpoint).
create table decisions (
  week_id text not null,
  theme_slug text not null,
  decision text not null check (decision in ('film', 'skip', 'investigate')),
  note text,
  decided_at timestamptz not null default now(),
  primary key (week_id, theme_slug)
);

-- Every Gemini call, successful or not.
create table llm_logs (
  id bigint generated always as identity primary key,
  run_id uuid not null references runs (id),
  task text not null check (task in ('cluster', 'write')),
  model text not null,
  attempt int not null,
  tokens_in int,
  tokens_out int,
  ok boolean not null,
  error text,
  created_at timestamptz not null default now()
);

create index video_snapshots_run_idx on video_snapshots (run_id);
create index themes_slug_idx on themes (slug);

alter table settings enable row level security;
alter table runs enable row level security;
alter table videos enable row level security;
alter table video_snapshots enable row level security;
alter table themes enable row level security;
alter table briefs enable row level security;
alter table decisions enable row level security;
alter table llm_logs enable row level security;
