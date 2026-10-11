import { describe, expect, it } from "vitest";
import { newsUrl, parseNewsFeed } from "@/lib/news";

const feed = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel><title>Search</title>
<item>
  <title>New AI coding tool launches in India - Example Times</title>
  <link>https://news.google.com/rss/articles/abc</link>
  <pubDate>Fri, 09 Oct 2026 08:00:00 GMT</pubDate>
  <source url="https://example.com">Example Times</source>
</item>
<item>
  <title>Second headline</title>
  <link>https://news.google.com/rss/articles/def</link>
  <pubDate>not a date</pubDate>
</item>
</channel></rss>`;

describe("Google News RSS", () => {
  it("builds the India English 7-day search URL", () => {
    expect(newsUrl("AI tools")).toBe(
      "https://news.google.com/rss/search?q=AI%20tools%20when%3A7d&hl=en-IN&gl=IN&ceid=IN:en",
    );
  });

  it("parses items, strips the source suffix and keeps bad dates as null", () => {
    expect(parseNewsFeed(feed)).toEqual([
      {
        title: "New AI coding tool launches in India",
        source: "Example Times",
        link: "https://news.google.com/rss/articles/abc",
        publishedAt: "2026-10-09T08:00:00.000Z",
      },
      { title: "Second headline", source: null, link: "https://news.google.com/rss/articles/def", publishedAt: null },
    ]);
  });

  it("handles a feed with a single item or none", () => {
    const one = feed.replace(/<item>\s*<title>Second[\s\S]*?<\/item>/, "");
    expect(parseNewsFeed(one)).toHaveLength(1);
    expect(parseNewsFeed("<rss><channel><title>x</title></channel></rss>")).toEqual([]);
  });

  it("rejects something that is not an RSS feed", () => {
    expect(() => parseNewsFeed("<html><body>Blocked</body></html>")).toThrow("unexpected shape");
  });
});
