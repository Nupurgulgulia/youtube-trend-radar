# Map check

Every box on the revised Components Map (`docs/Components_Map_Revised.webp`), the code that implements it, and how it was verified. Checked 2026-10-12.

| # | Map box | Code | Verified | Matches the map? |
|---|---|---|---|---|
| 1 | Ishaan sets his radar: categories, keywords, region, email; editable any week | `src/app/settings`, `src/lib/settings-form.ts`, `saveSettings` | Browser: bad region rejected, save works; unit tests | Yes. Also language and category IDs, as in CLAUDE.md |
| 2 | Vercel Cron starts one run per Sunday; early Sunday IST, cron in UTC; week ID stops a retry running twice; manual run needs a secret | `vercel.json`, `src/app/api/run/route.ts`, `src/lib/run.ts`, `src/lib/run-store.ts` | Unit tests; live lock SQL 8/8; 401 checks; real and dry runs through the route. **Cron firing on Vercel not yet verified** | Yes |
| 3 | YouTube Data API: trending in region, recent uploads per keyword; views, likes, comments, duration, publish date | `src/lib/youtube.ts` | Live: about 337 videos per run | Yes |
| 4 | Google News RSS: recent headlines per topic, with links; context only | `src/lib/news.ts`, `src/lib/news-match.ts` | Live: 10 headlines per keyword, matched per theme | Yes |
| 5 | Settings and history: settings, video_snapshots, themes; no history means momentum stays provisional | `db/migrations`, `src/lib/store.ts`, `src/lib/brief-store.ts` | Live on Neon | Yes. Relabelled "Neon Postgres" on 2026-10-12 (switched from Supabase at the student's request) |
| 6 | Collects within a quota budget; skips IDs already fetched; drops duplicates and deleted videos; logs failed or partial sources | `src/lib/quota.ts`, `src/lib/collector.ts` | Unit tests; live quota 13 to 15 units against a worst case of 14 to 16 | Yes |
| 7 | Measures, never guesses: views per day within age band; momentum only against a stored snapshot; formats and lengths with sample size and creator count; small samples flagged | `src/lib/scorer.ts`, `momentum.ts`, `findings.ts`, `confidence.ts`, `config/scoring.ts` | Unit tests; run on 344 real videos | Yes |
| 8 | Proposes the themes: 3 to 5 topics, strict JSON (name, video IDs, reason) | `src/lib/cluster.ts`, `src/lib/gemini.ts` | Live Gemini Flash | Yes. Addition inside the box: candidates are picked with a fair share per keyword |
| 9 | Checks every theme: coherent topic, 3+ videos from 2+ creators, real IDs and links, metrics traceable, status matches data, new or recurring; one retry; weak themes dropped | `src/lib/theme-gate.ts` | Unit tests; live | Yes |
| 10 | Writes the brief: four labelled parts per theme (YouTube evidence, outside context or "none found", interpretation, confidence and gaps); uses only the numbers given | `src/lib/write.ts` | Live | Yes. Also a filming angle and why-this-week, as in CLAUDE.md |
| 11 | Checks the written brief: every number, link and headline must exist in the evidence; decides publish, thin week or fail; one retry | `src/lib/publish-gate.ts` | Unit tests; live (blocked an invented "30,000") | Yes. Also checks whole dates, product codes and trend words |
| 12 | The Sunday brief: summary and top picks; per theme status, evidence links, formats with sample size, filming angle, confidence, what is uncertain; data coverage at the bottom | `src/components/BriefView.tsx`, `src/app/page.tsx`, `src/app/archive` | Browser, desktop and phone | Yes |
| 13 | Delivered before noon: sent once per week ID, checked before sending; a failed run sends a short notice | `src/lib/email.ts`, `src/lib/run.ts`, `claimEmail` | Real email sent and received; second run skipped | Yes. Detail: the failure notice waits for the last chance (catch-up or final attempt), so a failed 06:00 run does not pre-empt a good 09:00 run |
| 14 | Film, skip or investigate; choice saved for next week; human checkpoint | `src/app/actions.ts`, `saveDecision`, `loadPreviousDecisions` | Browser: decision and note saved to the database | Yes |
| 15 | Every run on record: brief, themes, run status, timings and errors, keyed by week | `src/lib/run-store.ts`, `src/app/runs` | Live: /runs shows every run | Yes. Relabelled "Neon Postgres" on 2026-10-12 |
| 16 | Momentum labels set by the Scorer, never by Gemini: rising, established, fading, insufficient evidence; first run only established or insufficient | `src/lib/momentum.ts` | Unit tests, including the first-run rule | Yes |

## Map changes

- 2026-10-12: steps **5** and **15** relabelled from "Supabase" to "Neon Postgres". Nothing else on the map was changed.

## Supporting pieces not drawn on the map

None of these is a new component; each sits inside a box above.

- `src/lib/auth.ts`: the admin password protection that steps 1, 2 and 14 refer to.
- `src/lib/analyse.ts`: runs steps 7 to 11 in order.
- `scripts/`: live test scripts. Not part of the deployed app.
