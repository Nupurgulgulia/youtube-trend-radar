# CLAUDE.md: YouTube Trend Radar (Sunday Content Brief)

You are the engineer building **YouTube Trend Radar**, a final examination project for Mesa School of Business, course "AI and its Applications". The student you are working with is a beginner at coding. Build working software, explain important decisions in plain language, and never pretend something works when you have not verified it.

The design source of truth is the **revised Components Map** (`docs/Components_Map_Revised.webp`). Every component in this file maps to a numbered step on that map. If the code and the map ever disagree, fix the code or flag the difference. Never add a component to the map that has not been built.

---

## 1. The user and the problem

**Ishaan** runs a tech YouTube channel for Indian audiences (AI tools, productivity apps, tech reviews) and posts three videos a week. Every Sunday he spends about 90 minutes browsing YouTube by hand. A video that caught a trend at the right time got 40,000 views in three days. One made two months late got 600.

He does not need another list of popular videos. He needs a **Sunday brief, delivered before noon IST**, with **three to five evidence-backed topic clusters** that tell him:

- which topics several creators are covering at the same time
- whether each topic is rising, established, fading, or not yet measurable
- which formats and lengths are performing, with sample sizes
- why the timing matters this week, with evidence kept separate from interpretation
- which videos and numbers support each claim
- what the system could not establish

His categories, keywords, region and email must be configurable. Every brief is archived so weeks can be compared.

**Ishaan makes the final decision.** The system recommends. It never scripts, schedules, uploads or publishes anything for him.

---

## 2. Non-negotiable rules

1. **Gemini Flash is the only AI model in the application.** Use the `@google/genai` SDK. Read the model ID from `GEMINI_MODEL`. Before the first AI call, check the current Flash model ID in Google AI Studio or the official Gemini docs and put it in `.env.example`. Never call the Claude API, OpenAI, or any other model from the app.
2. **Live data.** YouTube Data API v3 and Google News RSS. Mocked data is allowed only in tests and must never reach a real brief.
3. **Deploy on Vercel.** Next.js (App Router, TypeScript). Scheduling uses Vercel Cron.
4. **Never invent anything.** No made-up statistics, quota costs, API responses, news items, test results, or "it deployed fine" claims. If you did not run it and see the result, say so.
5. **Secrets stay on the server.** Every API key and the database connection string are read only in server code. Never expose them to the browser, never log them, never commit them. `.env.local` must be in `.gitignore` before the first commit.
6. **No em dashes in user-facing text** (brief page, email, UI labels, README prose). Use commas, colons or full stops.
7. **Numbers come from code, words come from Gemini.** Every metric, count, date, status label and confidence level is computed in TypeScript. Gemini may only describe numbers it was given.
8. **Keep it student-sized.** Do not add queues, extra databases, extra AI providers or frameworks the map does not show. Prefer small, readable functions over clever abstractions.
9. **Ask before** `git push`, deploying, running a migration against the live Neon database, or deleting anything.

---

## 3. Stack

| Concern | Choice |
|---|---|
| App and API routes | Next.js (App Router) + TypeScript |
| AI | Gemini Flash via `@google/genai`, JSON mode with `responseSchema` |
| Validation | `zod` for every external response and every Gemini output |
| Database | Neon (Postgres) via `@neondatabase/serverless`, server-side only, connection string in `DATABASE_URL` (switched from Supabase at the student's request) |
| Email | Resend |
| Scheduling | Vercel Cron |
| Tests | Vitest with fixture data |
| News | Google News RSS (`https://news.google.com/rss/search?q=<query>+when:7d&hl=en-IN&gl=IN&ceid=IN:en`), parsed with a small XML parser |

### Environment variables (document all of them in `.env.example` and the README)

```
YOUTUBE_API_KEY=
GEMINI_API_KEY=
GEMINI_MODEL=              # verify the current Flash ID before use
DATABASE_URL=              # Neon connection string, server only
RESEND_API_KEY=
BRIEF_FROM_EMAIL=          # e.g. onboarding@resend.dev until a domain is verified
BRIEF_TO_EMAIL=
CRON_SECRET=               # Vercel sends this as "Authorization: Bearer <CRON_SECRET>"
ADMIN_PASSWORD=            # protects Settings and the manual run button
APP_URL=
YOUTUBE_DAILY_QUOTA=10000  # confirm in Google Cloud Console for this project
YOUTUBE_SEARCH_DAILY_LIMIT=100 # search.list has its own daily bucket (docs checked 2026-10-11, see docs/quota.md)
QUOTA_SAFETY_MARGIN=0.5    # use at most this fraction of the remaining daily quota per run
```

---

## 4. Architecture: the numbered steps on the map

Build each step as a separate module under `src/lib/` with a single responsibility. The route `src/app/api/run/route.ts` (shared by cron and manual runs) calls them in order.

| # | Component | Responsibility |
|---|---|---|
| 1 | **Settings page** | Ishaan edits categories, keywords, region code, language, YouTube category IDs and email. Protected by `ADMIN_PASSWORD`. Saved to `settings`. |
| 2 | **Vercel Cron** | Starts one run per ISO week (see section 9). Rejects requests without the cron secret. |
| 3 | **YouTube Data API** | Trending in the configured region and category, plus recent uploads per keyword, plus statistics and details per video. |
| 4 | **Google News RSS** | Recent headlines per theme or keyword, with links. **Context only.** A headline never proves a YouTube trend. |
| 5 | **Database memory (Neon; the map still says Supabase)** | Settings, dated video snapshots, past themes, past briefs, run log. |
| 6 | **Collector** | Plans calls against a quota budget, skips IDs already fetched in this run, removes duplicates, marks deleted or private videos, records failed or partial sources, writes **dated snapshots**. |
| 7 | **Scorer (code only)** | Computes per-video and per-group metrics, momentum labels and format and length comparisons. No AI. |
| 8 | **Gemini call 1: cluster** | Proposes 3 to 5 candidate themes from the scored videos. Strict JSON. |
| 9 | **Theme Gate (code)** | Validates every theme, compares with past themes, drops weak themes, allows one retry. |
| 10 | **Gemini call 2: write** | Writes each theme in four labelled parts using only the evidence passed in. Strict JSON. |
| 11 | **Publish Gate (code)** | Checks the written brief against the evidence. Decides: publish, thin week, or fail. Allows one retry. |
| 12 | **Brief page** | The Sunday brief on the web, plus an archive of past weeks. |
| 13 | **Resend email** | Summary and link, sent once per week. A failed run sends a short failure notice instead. |
| 14 | **Ishaan's decision** | For each theme, Ishaan marks Film, Skip or Investigate on the brief page. Saved for next week. **Human checkpoint.** |
| 15 | **Run archive** | Every run, pass or fail: status, timings, errors, source coverage, quota used, tokens used. Keyed by week. |

---

## 5. Database (Neon Postgres)

Put the schema in `db/migrations/0001_init.sql`. Keep it small. Use stable IDs, unique constraints and upserts so a retried run never duplicates rows, and **never overwrite an older snapshot**.

- **`settings`**: a single row (`id = 1`). Holds `categories text[]`, `keywords text[]`, `region_code`, `relevance_language`, `category_ids int[]`, `email`, `updated_at`.
- **`runs`**:
  - Columns: `id uuid`, `week_id text unique` (ISO week, for example `2026-W42`), `status` (`running | succeeded | thin | failed`), `attempt int`, `started_at`, `finished_at`, `error text`, `source_report jsonb` (per source: ok, partial or failed, with a reason), `quota_estimated int`, `quota_used int`, `tokens_in int`, `tokens_out int`, `email_sent_at timestamptz`.
  - `week_id unique` is the lock that stops a duplicate run.
- **`videos`**: `video_id text primary key`, `channel_id`, `channel_title`, `title`, `published_at`, `duration_sec`, `tags text[]`, `category_id`, `first_seen_at`, `last_seen_at`, `unavailable boolean default false`.
- **`video_snapshots`**:
  - Columns: `video_id`, `observed_at timestamptz`, `observed_on date`, `run_id`, `views bigint`, `likes bigint null`, `comments bigint null`, `channel_subscribers bigint null`.
  - Add `unique (video_id, observed_on)`.
  - Insert with `on conflict do nothing`, so history is append-only.
  - `null` means "not available", which is different from zero.
- **`themes`**: `id uuid`, `run_id`, `week_id`, `slug text`, `name`, `momentum` (`rising | established | fading | insufficient_evidence`), `confidence` (`high | medium | low`), `video_ids text[]`, `metrics jsonb`, `format_findings jsonb`, `news jsonb`, `written jsonb`, `is_new boolean`, `recurring_from_week text null`. Add `unique (week_id, slug)`.
- **`briefs`**: `week_id text unique`, `run_id`, `status`, `content jsonb`, `published_at`.
- **`decisions`**: `week_id`, `theme_slug`, `decision` (`film | skip | investigate`), `note text null`, `decided_at`. Add `unique (week_id, theme_slug)`.
- **`llm_logs`**: `run_id`, `task` (`cluster | write`), `model`, `attempt`, `tokens_in`, `tokens_out`, `ok boolean`, `error text null`, `created_at`.

Turn Row Level Security on for every table. All access goes through server code that connects as the table owner using `DATABASE_URL`.

---

## 6. Data collection and quota (step 6)

1. **Verify before you trust.** Open the official YouTube quota cost page (`https://developers.google.com/youtube/v3/determine_quota_cost`). Record the current cost of every endpoint you use, plus any per-method daily caps, in `docs/quota.md`, with the date you checked. Mark anything you could not confirm as an assumption. Do not copy quota numbers from memory or from this file.
2. **Endpoints:**
   - `videos.list` with `chart=mostPopular`, region and category, `part=snippet,statistics,contentDetails`, `maxResults=50`.
   - `search.list` once per keyword, with `type=video`, `publishedAfter = now minus 7 days`, region, language, `order=viewCount`, `maxResults` at most 50.
   - `videos.list?id=` in batches of 50 for statistics on search results.
   - `channels.list?id=` in batches of 50 for subscriber counts. This is optional: it is used only to flag small channels and big channels, never to change status.
3. **Budget first.**
   - Write `estimateQuota(settings)` and call it before any request.
   - If the estimate exceeds `YOUTUBE_DAILY_QUOTA Ã— QUOTA_SAFETY_MARGIN`, cut the lowest-priority keywords, and say in the brief which ones were skipped and why.
   - Count actual units used and store them in `runs.quota_used`.
4. **No duplicate work.** Merge IDs from trending and search into a set before calling `videos.list`.
5. **Failures are data.**
   - Catch quota-exceeded (`403 quotaExceeded`), rate limits (`429` or `403 rateLimitExceeded`), network errors and malformed responses for each source.
   - Retry transient errors at most twice with backoff. Never retry quota errors.
   - Record each source as `ok`, `partial` or `failed` in `source_report`.
   - A news failure must not stop the run.
   - If YouTube collection fails completely, the run fails (see section 9).
6. **Deleted or private videos.** If a known ID returns nothing, set `unavailable = true`. Do not delete its history.

---

## 7. Scoring and momentum (step 7, code only)

Put every threshold in `src/lib/config/scoring.ts` as a named, commented constant. Explain each one in `docs/scoring.md`. The defaults below are **starting assumptions to tune**, not facts. Keep them conservative.

### Per-video metrics

- **Age:** `ageDays = max(0.5, (observed_at - published_at) / 1 day)`.
- **Views per day:** `viewsPerDay = views / ageDays`.
- **Engagement:** `engagementRate = (likes + comments) / views`, only when likes, comments and views are all present and views is at least `MIN_VIEWS_FOR_ENGAGEMENT` (default 1,000). Otherwise `null`.
- **Age band:** `0-2 days`, `3-7 days`, `8-14 days`, `15+ days`. Compare views per day **only within the same age band**, because young videos naturally have higher views per day.
- **Length bucket:**
  - `short` (3 minutes or less)
  - `mid` (over 3 up to 10 minutes)
  - `long` (over 10 up to 20 minutes)
  - `deep` (over 20 minutes)
- **Format:** `tutorial | review | comparison | news_reaction | explainer | list | other`, from transparent title and tag keyword rules in `src/lib/config/formats.ts`. Gemini must not classify formats.
- **Delta between snapshots:** `viewsGainedPerDay`. Compute it only when the same video has two snapshots at least `MIN_SNAPSHOT_GAP_DAYS` apart (default 5).

### Momentum labels (per theme)

| Label | When it applies |
|---|---|
| `rising` | A comparable earlier snapshot exists for at least `MIN_TRACKED_VIDEOS` videos in the theme (default 3), **and** either (a) median views gained per day rose by at least `RISING_RATIO` (default 1.25Ã—) versus the previous interval, or (b) the number of distinct creators on the topic grew versus the matching past theme. |
| `fading` | Comparable history exists, **and** median views gained per day fell to `FADING_RATIO` or below (default 0.75Ã—), **and** new uploads on the topic did not increase. |
| `established` | Several creators, strong views per day within their age band, but no history shows acceleration or decline. |
| `insufficient_evidence` | Too few videos or creators, missing metrics, or snapshots too close together to compare. |

- **First run:** no snapshots exist, so a theme can only be `established` or `insufficient_evidence`. Never `rising` or `fading`.
- Never claim acceleration from a single snapshot. Never present correlation as cause.

### Format and length findings (per theme and overall)

- Group by format, then by length bucket.
- Report median views per day (within comparable age bands), median engagement, **number of videos and number of distinct creators**.
- Make a claim like "reviews outperform tutorials" only when each side has at least `MIN_FORMAT_SAMPLE` videos (default 5) from at least `MIN_FORMAT_CREATORS` creators (default 3). Otherwise output `"Sample too small to compare"`.

### Confidence (per theme, code only)

Combine the number of videos, the number of creators, how many metrics were present, and whether history exists, into `high | medium | low`. Document the rule. **Confidence never comes from how Gemini words something.**

---

## 8. Gemini calls and quality gates (steps 8 to 11)

Both calls use JSON mode with a `responseSchema`. Validate the output again in code with `zod`. Log every call to `llm_logs`.

### Call 1: cluster (step 8)

- **Input:** a compact list of the scored top videos (ID, title, channel, top tags, format, length bucket, age band). Do **not** send raw metrics it could repeat back.
- **Output:** `{ themes: [{ name, slug, video_ids: string[], reason }] }`, with 3 to 5 themes.

### Theme Gate (step 9, code)

For each theme, check:

- **Every ID is real:** each video ID exists in this run's collected records, and links are built as `https://www.youtube.com/watch?v=<id>`.
- **No overlap:** no video appears in two themes.
- **Enough support:** at least 3 videos from at least 2 distinct channels.
- **Coherence:** at least `COHERENCE_MIN_SHARE` of the videos (default 0.6) share at least one significant keyword or tag with the theme name or with each other. Use a documented stopword list.
- **Traceable metrics:** every metric attached to the theme is recomputed from stored records.
- **Justified momentum:** the momentum label follows the rules in section 7.

Then compare against past themes (by slug and keyword overlap) to set `is_new` or `recurring_from_week`.

- **Retry rule:** if any theme fails, send Gemini **one** retry with a specific error list (for example, `"theme 'ai-agents': only 1 distinct creator; video X not in dataset"`).
- After the retry, **drop** themes that still fail. Never relax the rules so that a theme passes.

### Call 2: write (step 10)

- **Input:** for each surviving theme, the computed metrics, format findings, momentum, confidence, supporting videos (title, channel, date, link, views per day), and up to 3 news items (headline, source, date, link) matched to that theme by keyword.
- **Output per theme:**
  - `why_this_week`
  - `youtube_evidence`
  - `outside_context`: either a reference to one of the given news items by index, or exactly `"No related news found."`
  - `interpretation`
  - `filming_angle`: one specific idea for an Indian tech audience, not a generic title
  - `uncertain`
- **Output for the whole brief:** `executive_summary` and `top_opportunities`.
- **Instruction to Gemini:** use only the numbers, links and headlines provided; never state a trend direction different from `momentum`; mark interpretation as interpretation.

### Publish Gate (step 11, code)

- **Numbers:** extract every number in the written text and confirm each one matches a provided metric. Rounding is fine.
- **Links:** every link and headline must come from the input.
- **Status:** `momentum` and `confidence` must be unchanged.
- **Why now:** if `outside_context` is not `"No related news found."`, it must reference a real news item.
- **Retry rule:** on failure, allow **one** retry with the errors. If it still fails, publish that theme with its evidence block only and a note: `"Written summary failed checks."`

**Outcome:**

- `succeeded`: 3 to 5 themes passed.
- `thin`: 1 or 2 themes passed. Publish with a clear "thin week" note. Never pad the brief.
- `failed`: no theme passed, or collection failed.

Total Gemini calls per run are bounded at 4 (2 calls plus 2 retries).

---

## 9. Scheduling and reliability (steps 2, 13, 15)

- **Cron schedule.** Vercel Cron runs in **UTC**. IST is UTC+5:30. In `vercel.json`:
  - main run `"30 0 * * 0"` (06:00 IST Sunday)
  - catch-up `"30 3 * * 0"` (09:00 IST Sunday)
- **Hobby plan precision.** On the Hobby plan, cron jobs may fire up to an hour late and can run at most once per day. Verify the current limits in the Vercel docs and record them in the README.
- **Catch-up run.** It starts work only if this week's run is missing or `failed`, and only if `attempt < 2`.
- **Lock.** On start, upsert `runs` by `week_id`. If a run for this week is already `running` (started less than 15 minutes ago), `succeeded` or `thin`, exit without doing anything.
- **Function time.** Set `export const maxDuration` on the run route to the value your Vercel plan allows. Check the docs. Log how long each stage takes.
- **Email exactly once.**
  - Before sending, atomically claim it: `update runs set email_sent_at = now() where week_id = $1 and email_sent_at is null returning *`.
  - Send only if a row came back.
  - If Resend fails, clear the claim and record the error so the catch-up run can retry.
  - Also pass the `week_id` as an idempotency key if the current Resend API supports it. Check their docs.
- **Failed runs.** Send a short notice ("No brief this week: <reason>. Coverage report: <link>"), never a half-built brief.
- **Manual run.** `POST /api/run` with `ADMIN_PASSWORD`, plus a `dryRun` flag that does everything except send email.
- **Auth.** Cron requests must carry `Authorization: Bearer ${CRON_SECRET}`. Reject anything else with 401.
- **Status.** Every stage writes progress and errors to `runs`. A brief is never marked `succeeded`, or emailed, unless the Publish Gate passed.

---

## 10. The brief Ishaan sees (steps 12 to 14)

Keep the design simple and readable on a phone.

1. **Top:** week, run status (succeeded, or thin week), the executive summary, and the 1 to 3 strongest opportunities.
2. **One card per theme:**
   - Theme name, momentum badge and confidence badge, and "New this week" or "Recurring since <week>".
   - **Why it matters this week:** interpretation, visibly labelled as AI interpretation.
   - **Evidence (measured):** creator count, sample size, date range, median views per day, engagement where available, and the top videos with links, channel and date.
   - **Outside context:** the news item with source, date and link, or "No related news found."
   - **Formats and lengths:** findings with sample sizes, or "Sample too small to compare."
   - **Filming angle:** one specific idea.
   - **What is uncertain.**
   - **Ishaan's decision:** Film, Skip or Investigate buttons, saved to `decisions`.
3. **Bottom: data coverage.** Videos scanned, keywords searched or skipped, sources ok, partial or failed, quota used against the estimate, first run or not, and limitations that affect the recommendations.
4. **Archive:** a list of past weeks, linking to each brief.

**Styling rule:** measured facts and AI interpretation must look different, for example a neutral box for facts and a tinted box labelled "Interpretation".

---

## 11. Tests (Vitest, deterministic fixtures in `tests/fixtures/`)

Write focused unit tests for logic, not just "the route returns 200". At minimum:

- **Scoring:** views per day, age bands, length buckets, format rules, null-safe engagement.
- **Momentum:**
  - first run gives `established` or `insufficient_evidence` only
  - comparable history gives `rising` or `fading` correctly
  - snapshots too close together give `insufficient_evidence`
- **Format findings:** small samples return "Sample too small to compare".
- **Collector:**
  - duplicate IDs across sources are fetched once
  - deleted videos are flagged
  - partial source failure is recorded
  - a quota-exceeded error stops further YouTube calls and is not retried
- **Quota:** the estimator matches a hand calculation for a given settings fixture, and keywords are cut when over budget.
- **Theme Gate:**
  - an invented ID fails
  - a single-creator theme fails
  - an overlapping video fails
  - an incoherent theme fails
  - one retry happens, then the theme is dropped
- **Gemini output:** malformed JSON, missing fields and wrong types are rejected by `zod`.
- **Publish Gate:**
  - an invented number fails
  - an invented link or headline fails
  - a changed momentum label fails
- **Outcome:** 0 themes gives `failed`, 1 to 2 gives `thin`, 3 to 5 gives `succeeded`.
- **Reliability:**
  - a second run in the same week exits without work
  - an email is never sent twice
  - snapshot upserts never overwrite older rows

Run `tsc --noEmit`, lint, `next build` and `vitest run`. Report the actual output. Separately list what still needs live credentials or a real deployment to verify: live API calls, the cron firing on Vercel, email delivery, and the real quota used.

---

## 12. Build order (checkpoints)

Work in this order. Finish each "Done when" before moving on, and commit after each checkpoint.

| CP | Build | Done when |
|---|---|---|
| 0 | Look at the folder. If code already exists, audit it against this file and the map first, and report what is built, partial, missing or broken. | The student has a short findings list. |
| 1 | Next.js + TypeScript scaffold, `.env.example`, `.gitignore`, Vitest, zod | `npm run build` and `npm test` both run. |
| 2 | Migration `0001_init.sql` + Neon server client | The student has applied the migration (after you ask), and the tables exist. |
| 3 | `docs/quota.md` (verified), quota estimator + tests | Estimator tests pass. |
| 4 | Collector (YouTube + News) with fixtures and failure handling | Collector tests pass, and a manual dry run against the live API stores videos and snapshots. Report only what you observed. |
| 5 | Scorer, momentum, formats, confidence + tests | All scoring tests pass, and `docs/scoring.md` is written. |
| 6 | Gemini call 1 + Theme Gate + tests | Gate tests pass, and one live dry run produces validated themes, or a clear failure reason. |
| 7 | Gemini call 2 + Publish Gate + tests | Gate tests pass, and one live dry run produces a brief that passes, or a clear failure reason. |
| 8 | Brief page, archive, decisions, Settings page | The student can view a brief and click Film, Skip or Investigate, and the decision is saved. |
| 9 | Run route, lock, cron config, email-once, failure notice + tests | Reliability tests pass, and a manual non-dry run sends one email. |
| 10 | README, `.env.example`, map check | The README explains setup, env vars, the migration, cron in UTC, the scoring rules and known limitations, and every map box matches real code. |

---

## 13. How to work with the student

- Explain each important change in one or two plain sentences. Avoid jargon, or define it in brackets the first time.
- Make reasonable, reversible decisions without asking lots of questions. State your assumptions.
- When you need something only the student can provide (API keys, applying a migration, a Vercel setting, a redeploy), stop and give exact step-by-step instructions.
- Never paste secrets into chat, code or logs. If the student pastes one, remind them to rotate it.

### Handover format at the end of every major step

- **A. What changed**, and which problem each change solves.
- **B. What was already working**, and what you kept.
- **C. What the student must do manually**, for example environment variables, the migration, redeploying, or setting `CRON_SECRET` in Vercel.
- **D. Test results:** for each test, passed, failed, or not run. Live integrations are listed as unverified unless observed.
- **E. Remaining limitations** and their practical impact.
- **F. Map check:** any box on the Components Map that the code does not yet implement.
- **G. Acceptance checklist:** mark each item *Implemented and tested*, *Implemented but not fully verified*, or *Not implemented*:
  - Live YouTube data collection
  - Quota assumptions verified against official docs
  - Configurable categories, keywords and region
  - Momentum distinguishes popularity from acceleration, with no unsupported claims
  - Themes are coherent and traceable to source videos
  - Format and length insights include sample sizes and limitations
  - "Why now" separates evidence, context and interpretation
  - Quality gates block unsupported themes and invented claims
  - Historical snapshots enable week-to-week comparison
  - Sunday schedule and UTC/IST assumptions are correct
  - Failures are handled safely, and email is sent at most once per week
  - The archive has no duplicate records
  - The brief gives Ishaan an actionable Film, Skip or Investigate decision
  - Gemini Flash is the only AI model in the app
  - README, `.env.example` and the Components Map match the code
