// YouTube Data API quota costs used by the estimator (map step 6).
// Source: https://developers.google.com/youtube/v3/determine_quota_cost
// Page "Last updated 2026-10-08 UTC", checked on 2026-10-11. See docs/quota.md.
// If Google changes these, update this file and docs/quota.md together.

// General bucket: 10,000 units per day by default, shared by every method
// except search.list and videos.insert.
export const COST_VIDEOS_LIST = 1;
export const COST_CHANNELS_LIST = 1;
export const COST_VIDEO_CATEGORIES_LIST = 1;

// search.list has its own bucket: a default limit of 100 calls per day, 1 per call.
export const COST_SEARCH_LIST = 1;

// API limits on ids per request and results per page.
export const MAX_IDS_PER_REQUEST = 50;
export const MAX_RESULTS_PER_PAGE = 50;

// The collector requests exactly one page per trending call and per search,
// so the estimate is one call each. It never follows nextPageToken.
export const PAGES_PER_CALL = 1;
