# YouTube Trend Radar

A Sunday content brief for Ishaan, who runs a tech YouTube channel for Indian audiences. Every Sunday morning (IST) it collects a week of live YouTube data, finds three to five topics that several creators are covering at once, measures them in code, and emails a short brief with a link to the full page. Ishaan marks each topic **Film**, **Skip** or **Investigate**. The system recommends. It never scripts, schedules or uploads anything.

Final examination project, Mesa School of Business, "AI and its Applications" (Problem Statement 13). The design source of truth is the Components Map in `docs/Components_Map_Revised.webp`. See [docs/map-check.md](docs/map-check.md) for how each box maps to code.

## How it works

Numbers come from code. Words come from Gemini Flash, the only AI model in the app, and every word is checked against the numbers before it is published.

| Map step | What happens | Code |
|---|---|---|
| 1 Settings | Ishaan edits categories, keywords (in priority order), region, language, category IDs and email | `src/app/settings`, `src/lib/settings-form.ts` |
| 2 Vercel Cron | Sunday 06:00 IST main run and 09:00 IST catch-up, one run per week | `vercel.json`, `src/app/api/run/route.ts`, `src/lib/run.ts` |
| 3 YouTube Data API | Trending in the region and category, recent uploads per keyword, stats per video | `src/lib/youtube.ts` |
| 4 Google News RSS | Headlines per keyword and per theme. Context only, never proof of a trend | `src/lib/news.ts`, `src/lib/news-match.ts` |
| 5 Database memory | Settings, videos, dated snapshots, themes, briefs, decisions, run log | `db/migrations`, `src/lib/store.ts` |
| 6 Collector | Quota budget first, each video fetched once, failures recorded per source | `src/lib/quota.ts`, `src/lib/collector.ts` |
| 7 Scorer | Views per day, age bands, length buckets, formats, momentum, confidence. No AI | `src/lib/scorer.ts`, `momentum.ts`, `findings.ts`, `confidence.ts` |
| 8 Gemini call 1 | Proposes 3 to 5 themes from a fair share of videos per keyword, without metrics | `src/lib/cluster.ts` |
| 9 Theme Gate | Real IDs, no overlap, 3 videos from 2 channels, coherence; one retry, then drop | `src/lib/theme-gate.ts` |
| 10 Gemini call 2 | Writes each theme in labelled parts from the evidence only | `src/lib/write.ts` |
| 11 Publish Gate | Checks every number, date, link, quote and trend word; decides succeeded, thin or failed | `src/lib/publish-gate.ts` |
| 12 Brief page | The brief, with measured facts and AI interpretation styled differently, plus the archive | `src/components/BriefView.tsx`, `src/app/archive` |
| 13 Resend email | One email per week: the brief, or a short failure notice | `src/lib/email.ts`, `src/lib/run.ts` |
| 14 Ishaan's decision | Film, Skip or Investigate per theme, shown again next time | `src/app/actions.ts`, `src/lib/brief-store.ts` |
| 15 Run archive | Every run with status, timings, errors, coverage, quota and tokens | `src/lib/run-store.ts`, `src/app/runs` |

The rules behind each step are documented in [docs/quota.md](docs/quota.md), [docs/scoring.md](docs/scoring.md) and [docs/quality-gates.md](docs/quality-gates.md).

## Stack

Next.js 15 (App Router, TypeScript), Neon Postgres (`@neondatabase/serverless`), Gemini Flash (`@google/genai`), Resend, Vercel Cron, zod, Vitest.

The Components Map and the original brief said Supabase. The database was switched to **Neon** at the student's request on 2026-10-11. Both are hosted Postgres; the schema is the same.

## Setup

You need Node.js 20 or newer (built with Node 24) and accounts for Neon, Google Cloud (YouTube Data API v3), Google AI Studio (Gemini), Resend and Vercel.

1. Install dependencies:
   ```bash
   npm install
   ```
2. Copy `.env.example` to `.env.local` and fill in the values (see the next section). `.env.local` is in `.gitignore` and must never be committed.
3. Create the database tables. In the Neon console, open the SQL Editor and run, in order:
   - `db/migrations/0001_init.sql` (all tables, row level security, default settings)
   - `db/migrations/0002_snapshot_found_by.sql` (records which keyword found each video)
4. Check the connections:
   ```bash
   npm run check:db
   ```
   ```bash
   npm run check:gemini
   ```
5. Start the app at http://localhost:3000:
   ```bash
   npm run dev
   ```

## Environment variables

All of them are read only in server code. Never paste them into chat, code or logs.

| Variable | What it is |
|---|---|
| `YOUTUBE_API_KEY` | YouTube Data API v3 key (Google Cloud Console, APIs and Services, Credentials) |
| `GEMINI_API_KEY` | Gemini API key from Google AI Studio |
| `GEMINI_MODEL` | `gemini-3.8-flash`, the newest stable Flash model on 2026-10-11. The app refuses any model without "flash" in its name |
| `DATABASE_URL` | Neon pooled connection string. Contains the database password |
| `RESEND_API_KEY` | Resend API key |
| `BRIEF_FROM_EMAIL` | Sender. `onboarding@resend.dev` works until you verify your own domain |
| `BRIEF_TO_EMAIL` | Recipient, used when the Settings page has no email |
| `CRON_SECRET` | Random string. Vercel sends it as `Authorization: Bearer <CRON_SECRET>` on cron calls |
| `ADMIN_PASSWORD` | Protects Settings, decisions and the manual run |
| `APP_URL` | Public URL of the app, used in email links (`http://localhost:3000` locally) |
| `YOUTUBE_DAILY_QUOTA` | General quota units per day, default 10,000. Confirm in Google Cloud Console |
| `YOUTUBE_SEARCH_DAILY_LIMIT` | `search.list` calls per day, default 100 (its own bucket since 2026-10-08) |
| `QUOTA_SAFETY_MARGIN` | Share of each daily bucket one run may use, default 0.5 |

## Schedule (UTC and IST)

Vercel Cron runs in **UTC**. India is UTC+5:30.

| Job | Cron (UTC) | IST |
|---|---|---|
| Main run | `30 0 * * 0` | Sunday 06:00 |
| Catch-up | `30 3 * * 0` | Sunday 09:00 |

What the Vercel docs said on 2026-10-11:

- **Hobby timing:** each cron job may fire any time within its hour, so the main run starts by 07:29 IST at the latest and the catch-up by 10:29 IST, both before noon. Hobby allows only daily (or less frequent) schedules, which a weekly job is.
- **No retries, possible duplicates:** Vercel does not retry a failed cron call and can occasionally deliver the same call twice. The app handles this with a weekly lock (below) and the catch-up run.
- **Time limit:** functions can run for up to 300 seconds on Hobby. `maxDuration` on `/api/run` is set to 300. A full run took 61 to 92 seconds in testing.
- **Region:** functions run in Singapore (`sin1`, set in `vercel.json`), next to the Neon database.

**How a week is protected:**

- **Week labels:** each brief belongs to the ISO week of the most recent Sunday in India time, for example `2026-W41`. A manual run on a weekday counts as a late brief for the Sunday just gone, so it can never use up next Sunday's run.
- **Lock:** a run starts only if the week has no run yet, or the last one failed (or has been stuck "running" for 15 minutes) and there have been fewer than 2 attempts. The check is a single database statement, so two runs at the same moment cannot both start.
- **Email once:** before sending, the run claims the week's email in one database statement and sends only if it won the claim. If Resend fails, the claim is released and the next run retries only the email. Resend also receives an idempotency key (`brief-<week>` or `failure-<week>`).
- **Failure notice:** a failed main run sends nothing, because the catch-up may still succeed. When the last chance fails (the catch-up, a manual run, or the final attempt), Ishaan gets one short notice with a link to the run archive, never a half-built brief.

## Manual runs

Log in on the Settings page and use **Run now**, or call the route directly:

```bash
curl -X POST http://localhost:3000/api/run -H "Authorization: Bearer $ADMIN_PASSWORD" -H "Content-Type: application/json" -d "{\"dryRun\": true}"
```

- **Dry runs:** a run is dry unless the body says `"dryRun": false`. A dry run does everything except send email and is saved under its own `dryrun-<time>` label, so it never blocks the real Sunday run.
- **Real runs:** a real manual run follows the same lock and email-once rules as the cron.

## Scoring rules in brief

Full details, and every threshold, are in [docs/scoring.md](docs/scoring.md) and `src/lib/config/scoring.ts`. All thresholds are starting assumptions to tune, not facts.

- **Views per day** is compared only with videos of the same age band (0-2, 3-7, 8-14, 15+ days), as a "band index" where 1.0 means typical for its age.
- **Engagement** is (likes + comments) / views, only with 1,000+ views and all three numbers present. Missing data stays empty, never zero.
- **Momentum:** rising and fading need snapshots of the same videos at least 5 days apart. A first run can only say established or insufficient evidence, however popular a topic is.
- **Formats and lengths** are compared only when each group has at least 5 videos from 3 creators. Otherwise the brief says "Sample too small to compare".
- **Confidence** gets one point each for 8+ videos, 5+ creators, engagement for 70% of videos, and comparable history. High confidence is impossible without history.

## Tests and checks

```bash
npm test
```

158 unit tests with fixtures, no network. They cover scoring, momentum, format findings, the collector, quota, both quality gates, Gemini output validation, outcomes, email content, and reliability: a second run in the same week does nothing, email is never sent twice, snapshots are never overwritten.

```bash
npm run typecheck
```

```bash
npm run lint
```

```bash
npm run build
```

Live scripts (they use your real keys and database, and never send email):

| Script | What it does |
|---|---|
| `npm run check:db` | Connects to Neon and lists the tables |
| `npm run check:gemini` | Checks the Gemini key and model |
| `npm run collect:test` | Live YouTube and news collection, stores videos and snapshots |
| `npm run score:test` | Scores the latest stored day, read only |
| `npm run themes:test` | Live Gemini clustering and the Theme Gate, does not save themes |
| `npm run brief:test -- --save` | Live steps 7 to 11, saves a clearly labelled test preview |
| `npm run reliability:test` | Lock and email-once SQL against the real database, with a test label |

## What has been verified, and what has not

Verified by running it (2026-10-11 and 2026-10-12):

- Live YouTube collection: about 337 videos from about 280 channels, 13 to 15 quota units and 6 searches per run
- Live Gemini clustering and writing, with the Publish Gate blocking an invented number
- A full real run through `/api/run`: brief for `2026-W41` published, one email sent through Resend and received; a second run was skipped
- Lock and email-once SQL against Neon (8 of 8 checks), 401 for every wrong credential
- Brief page, decisions saved to the database, Settings validation, phone width

Not yet verified:

- The cron jobs firing on Vercel (needs a deployment and a Sunday)
- Behaviour on Vercel itself (function region, time limit, environment variables)
- Rising and fading momentum on real data (needs snapshots from at least two Sundays; rising from acceleration needs three)

## Known limitations

- **No momentum before week two.** The first briefs can only say established or insufficient evidence.
- **English-only format rules.** About 60% of collected titles (Hindi, Telugu, Malayalam, Shorts with no format words) are "other".
- **"Typical" is relative to this week's sample,** not all of YouTube.
- **Loose news matching.** Headlines are matched by any shared keyword, so loosely related stories can be offered. Gemini usually picks the relevant one, and the page always shows our stored headline and link.
- **Unchecked number words.** Numbers written as words ("four videos") are not checked by the Publish Gate.
- **Best-effort cron.** If Vercel misses both Sunday runs, there is no brief that week until someone presses Run now.
- **One shared admin password,** no user accounts.
- **Quota assumptions.** Assumes this app is the only user of the YouTube API key, and that `search.list` calls are not also charged to the 10,000 general units (see docs/quota.md).

## Deploying to Vercel

1. Push the repository to GitHub and import it in Vercel.
2. In Vercel, under Project Settings, Environment Variables, add every variable from the table above. Set `APP_URL` to the deployed URL. Keep `CRON_SECRET` exactly as in `.env.local`, or generate a new one.
3. Deploy. The cron jobs in `vercel.json` appear under Settings, Cron Jobs.
4. Check `/runs` after the first Sunday, or press Run now on Settings for a dry run.
