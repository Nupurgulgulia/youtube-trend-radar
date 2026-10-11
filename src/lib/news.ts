import { XMLParser } from "fast-xml-parser";
import { z } from "zod";

// Google News RSS (map step 4). Context only: a headline never proves a YouTube trend.
// A news failure is recorded but never stops the run.

export type NewsItem = {
  title: string;
  source: string | null;
  link: string;
  publishedAt: string | null; // ISO date, or null if the feed did not give a parseable one
};

const MAX_ITEMS_PER_QUERY = 10;

export function newsUrl(query: string): string {
  const q = encodeURIComponent(`${query} when:7d`);
  return `https://news.google.com/rss/search?q=${q}&hl=en-IN&gl=IN&ceid=IN:en`;
}

const text = z.union([z.string(), z.number()]).transform(String);
const itemSchema = z.object({
  title: text,
  link: z.string().url(),
  pubDate: text.optional(),
  source: z.union([text, z.object({ "#text": text })]).optional(),
});
const feedSchema = z.object({
  rss: z.object({
    channel: z.object({
      item: z.union([itemSchema, z.array(itemSchema)]).optional(),
    }),
  }),
});

export function parseNewsFeed(xml: string): NewsItem[] {
  const parser = new XMLParser({ ignoreAttributes: true, parseTagValue: false });
  const result = feedSchema.safeParse(parser.parse(xml));
  if (!result.success) throw new Error("News feed had an unexpected shape");
  const raw = result.data.rss.channel.item;
  const items = raw === undefined ? [] : Array.isArray(raw) ? raw : [raw];

  return items.slice(0, MAX_ITEMS_PER_QUERY).map((i) => {
    const source = i.source === undefined ? null : typeof i.source === "string" ? i.source : i.source["#text"];
    // Google News titles end with " - Source Name". Keep the headline only.
    const title = source && i.title.endsWith(` - ${source}`) ? i.title.slice(0, -(source.length + 3)) : i.title;
    const date = i.pubDate ? new Date(i.pubDate) : null;
    return {
      title,
      source,
      link: i.link,
      publishedAt: date && !Number.isNaN(date.getTime()) ? date.toISOString() : null,
    };
  });
}

export async function fetchNews(
  query: string,
  fetchFn: (url: string) => Promise<Response> = (url) => fetch(url),
): Promise<NewsItem[]> {
  const res = await fetchFn(newsUrl(query));
  if (!res.ok) throw new Error(`Google News returned HTTP ${res.status}`);
  return parseNewsFeed(await res.text());
}
