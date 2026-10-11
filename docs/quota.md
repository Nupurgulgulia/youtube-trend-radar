# YouTube Data API quota

**Source:** https://developers.google.com/youtube/v3/determine_quota_cost
**Page version:** "Last updated 2026-10-08 UTC"
**Checked on:** 2026-10-11, by downloading the page and reading the text directly.

The numbers in this file are copied into `src/lib/config/quota.ts`. If Google changes the page, update both.

## What the official page says

- Every request costs at least 1 unit, **including invalid requests**.
- New projects get, by default:
  - **100 `search.list` calls per day**, in their own bucket, at **1 unit per call**
  - 100 `videos.insert` calls per day, in their own bucket (this app never uploads)
  - **10,000 units per day** shared by all other methods
- Quotas reset at **midnight Pacific Time**, which is 12:30 or 13:30 IST, depending on US daylight saving. A Sunday 06:00 IST run therefore uses Saturday's Pacific day.
- Each extra page of results costs the method's quota again.

### Change from older documentation

Older versions of this page said `search.list` cost **100 units** from the shared 10,000. The version above replaces that with a separate 100-call bucket at 1 unit per call. This app follows the current page. If your Google Cloud Console shows something different, trust the console and update the two env variables below.

## Methods this app uses

| Method | Used for | Cost (from page) | Bucket |
|---|---|---|---|
| `videos.list` (`chart=mostPopular`) | Trending in region and category | 1 per call | General (10,000) |
| `search.list` (`type=video`) | Recent uploads per keyword | 1 per call | Search (100 calls) |
| `videos.list` (`id=`, up to 50 IDs) | Stats for search results and tracked videos | 1 per call | General |
| `channels.list` (`id=`, up to 50 IDs) | Subscriber counts (optional) | 1 per call | General |
| `videoCategories.list` | One-off check that category 28 is "Science & Technology" | 1 per call | General |

## How a run is estimated

`estimateQuota()` in `src/lib/quota.ts` gives a worst case before any call is made:

- **Trending:** 1 call per configured category ID, or 1 region-wide call if none is set. Results include stats, so there's no extra lookup.
- **Search:** 1 call per keyword (one page, up to 50 results). It never follows a second page.
- **Search stats:** keywords × 50 IDs, in batches of 50.
- **Tracked videos:** videos from earlier weeks whose stats are refreshed so momentum can compare snapshots, in batches of 50.
- **Channels (optional):** every video ID counted as a different channel, in batches of 50.

**Worked example (default settings):** 1 category, 6 keywords, 120 tracked videos, channels on.

- General units: 1 trending + 6 search batches + 3 tracked batches + 10 channel batches = **20 units**
- Search calls: **6**

That's tiny next to the budget, so quota is not expected to limit this app at its current size.

## Budget per run

```
general limit = YOUTUBE_DAILY_QUOTA        × QUOTA_SAFETY_MARGIN   (default 10,000 × 0.5 = 5,000 units)
search limit  = YOUTUBE_SEARCH_DAILY_LIMIT × QUOTA_SAFETY_MARGIN   (default 100 × 0.5 = 50 calls)
```

If either limit is exceeded, `planQuota()` drops keywords from the **end** of the keyword list, so list order is priority order. Skipped keywords and the reason are recorded so the brief can show them. Actual units used are counted during collection and stored in `runs.quota_used`.

## Assumptions (not confirmed)

1. **Search calls are not also charged to the 10,000 units.** The page says 10,000 units are "combined for all other endpoints", which suggests search is separate, but it doesn't say so outright. To check: run once and compare the Quotas page in Google Cloud Console.
2. **Cost does not depend on which `part` values are requested.** The page lists a flat cost per method and says nothing about parts.
3. **The project uses the default allocation.** Confirm both numbers on Google Cloud Console > APIs & Services > YouTube Data API v3 > Quotas.
4. **This app is the only user of the API key.** The API can't report how much quota is left, so the budget assumes nothing else used it that day.

## Confirmed by a live run

- **Category 28 is "Science & Technology" in region IN.** Checked with `videoCategories.list` on 2026-10-11.
- **First live collection (2026-10-11, default settings):** estimated 14 general units (worst case) and 6 searches. Used 14 units, plus 1 for the category check, and 6 searches.
