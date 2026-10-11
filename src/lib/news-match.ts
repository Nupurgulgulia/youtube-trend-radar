import { keywords } from "./config/keywords";
import type { NewsItem } from "./news";

// Matches Google News headlines to a theme by keyword (map step 4 feeding step 10).
// Context only: a matching headline never proves a YouTube trend.

export const MAX_NEWS_PER_THEME = 3;

// Up to 3 headlines that share at least one significant keyword with the theme name,
// most overlap first, then most recent. Duplicate links are removed.
export function matchNews(themeName: string, pool: NewsItem[]): NewsItem[] {
  const want = keywords(themeName);
  const seen = new Set<string>();
  return pool
    .filter((n) => (seen.has(n.link) ? false : (seen.add(n.link), true)))
    .map((n) => ({ n, overlap: [...keywords(n.title)].filter((k) => want.has(k)).length }))
    .filter((x) => x.overlap > 0)
    .sort((a, b) => b.overlap - a.overlap || (b.n.publishedAt ?? "").localeCompare(a.n.publishedAt ?? ""))
    .slice(0, MAX_NEWS_PER_THEME)
    .map((x) => x.n);
}
