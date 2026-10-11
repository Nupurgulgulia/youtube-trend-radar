# Scoring rules

Map step 7, the Scorer. All of this is plain TypeScript with no AI. Every threshold lives in
`src/lib/config/scoring.ts` and every format rule in `src/lib/config/formats.ts`.
The numbers below are **starting assumptions to tune**, chosen to be conservative. None of them is a measured fact about YouTube.

## Per-video metrics (`src/lib/scorer.ts`)

| Metric | Rule | Why |
|---|---|---|
| Age | `max(0.5, days since publish)` | A video published an hour ago would otherwise get an absurd views-per-day figure. |
| Views per day | `views / age` | Puts old and new videos on one scale. `null` if YouTube gives no view count. |
| Engagement | `(likes + comments) / views`, only if all three exist and views ≥ **1,000** | Below 1,000 views, a few likes swing the rate wildly. Missing data stays `null`, never zero. |
| Age band | `0-2`, `3-7`, `8-14`, `15+` days | Young videos naturally have higher views per day, so videos are only compared within their band. |
| Band index | views per day ÷ median views per day of all videos **in the same band, in this run** | 1.0 means typical for its age, 2.0 means twice the typical. This is how "strong" is measured. |
| Length | `short` ≤ 3 min, `mid` ≤ 10, `long` ≤ 20, `deep` > 20, `unknown` if no duration | Shorts and long videos behave very differently. |
| Format | Keyword rules on the title, then on tags only if the title matches nothing | Transparent and testable. Gemini never classifies formats. |

### Format rules

Checked in this order. The first match wins.

1. **comparison:** vs, versus, compare, better than, "which ... best/better/smartest"
2. **review:** review, unboxing, hands-on, worth it, honest opinion, long-term
3. **tutorial:** how to, tutorial, guide, step by step, for beginners, course
4. **list:** "top 10", "best 5", "7 apps", "10 tools" and similar
5. **news_reaction:** news, launch, announced, leak, reaction, just dropped, is here, breaking
6. **explainer:** explained, what is, how does, why, everything you need to know, the truth
7. **other:** anything else

The word "setup" was removed from the tutorial rules after the first live run, because titles like "LED Light Setup Gone Right" are not tutorials.

## Views gained between snapshots (`src/lib/momentum.ts`)

For each video, the latest snapshot is compared with the **latest earlier snapshot at least 5 days before it** (`MIN_SNAPSHOT_GAP_DAYS`):

```
current gain per day = (views now - views then) / days between
```

If there's an even earlier snapshot at least 5 days before that one, the same calculation gives the **previous** interval. Snapshots closer than 5 days apart are ignored as too noisy.

## Momentum labels (per theme)

The checks run in this order:

1. **insufficient_evidence** if the theme has fewer than **3** videos, fewer than **2** creators, or fewer than **80%** of its videos have a view count.
2. **insufficient_evidence** if earlier snapshots exist but are all less than 5 days old ("too close to compare").
3. When at least **3** videos have comparable history (`MIN_TRACKED_VIDEOS`):
   - **rising** if median current gain ÷ median previous gain is ≥ **1.25**, using only videos that have both intervals
   - **fading** if that ratio is ≤ **0.75** **and** new uploads (published in the last 7 days) did not increase versus the matching past theme
   - **rising** if distinct creators grew versus the matching past theme, unless the ratio says it's declining
   - otherwise the history shows no clear direction, so go to step 4
4. **established** if at least **3** creators and the median band index is ≥ **1.0**. Otherwise **insufficient_evidence**.

This keeps popularity and acceleration apart:

- **First run:** there are no earlier snapshots, so steps 2 and 3 can't apply. A theme can only be established or insufficient_evidence, however popular it is. A test checks this with a band index of 50.
- **Rising from the gain ratio needs three snapshots,** so the earliest it can happen is the third weekly run.
- **Rising from creator growth needs two weekly snapshots** plus a matching theme from an earlier week.
- **Fading always needs a past theme,** because "uploads did not increase" can't be shown without one.
- **None of this proves cause.** A rise in views alongside a news story is a correlation.

## Format and length findings (`src/lib/findings.ts`)

For every group, the findings report: number of videos, distinct creators, median views per day, median band index, median engagement, and how many videos had engagement data.

- A group is **comparable** only with at least **5** videos from at least **3** creators.
- A ranking is given only when **2 or more** groups are comparable. Otherwise the output is exactly "Sample too small to compare".
- Rankings use the **median band index**, so groups are compared on views relative to age, not raw views.
- There are three levels: all formats, all lengths, and **formats within each length bucket**. The last one was added after the first live run, where 220 of 335 videos were shorts and would otherwise dominate every format.

## Confidence (`src/lib/confidence.ts`)

One point for each of these:

- at least **8** videos
- at least **5** distinct creators
- engagement known for at least **70%** of videos
- comparable snapshot history (step 3 above applied)

| Points | Confidence |
|---|---|
| 4 | high |
| 2 to 3 | medium |
| 0 to 1 | low |

**insufficient_evidence** is always **low**. Because history is one of the points, **high confidence is impossible on the first run.** Confidence never depends on how Gemini words anything.

## What the first live run showed (2026-10-11, 335 videos, 277 creators)

Measured by `npm run score:test`:

- **Age bands:** 0-2 days: 53, 3-7 days: 266, 8-14 days: 8, 15+ days: 8.
- **Engagement:** available for 307 of 335 videos.
- **Formats:** 207 of 335 (62%) were "other". Most of these are Hindi, Telugu or Malayalam titles, or Shorts with no format words. The keyword rules only understand English, which is the main limitation of format findings.
- **Tag fallback is noisy:** a Shorts video with an "unboxing" tag gets labelled a review even if it's a family surprise video.

## Known limitations

1. **Thresholds are untuned guesses.** They should be revisited after a few weeks of real data.
2. **The band index depends on this run's sample.** "Typical" means typical among the videos collected, not across all of YouTube.
3. **English-only format rules,** as described above.
4. **No momentum before the second week.** Rising from the gain ratio needs the third week.
