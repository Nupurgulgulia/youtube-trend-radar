import { scoreVideos, type ScoredVideo, type VideoInput } from "@/lib/scorer";

// A small, fixed dataset for Theme Gate tests: three clear topics plus noise.
export const observedAt = "2026-10-11T00:30:00Z";

const v = (videoId: string, channelId: string, title: string, tags: string[] = []): VideoInput => ({
  videoId,
  channelId,
  channelTitle: `Channel ${channelId}`,
  title,
  publishedAt: "2026-10-08T00:30:00Z",
  durationSec: 600,
  tags,
  views: 50_000,
  likes: 2_000,
  comments: 300,
});

export const videos: ScoredVideo[] = scoreVideos(
  [
    v("cur1", "a", "Cursor IDE full walkthrough", ["cursor", "ai coding"]),
    v("cur2", "b", "Cursor vs Copilot for Indian devs", ["cursor", "copilot"]),
    v("cur3", "c", "I built an app with Cursor in 1 hour", ["cursor"]),
    v("cur4", "d", "Cursor agent mode explained", ["cursor", "agents"]),
    v("pix1", "a", "Pixel 10 camera test", ["pixel", "google"]),
    v("pix2", "e", "Pixel 10 battery after a week", ["pixel"]),
    v("pix3", "f", "Pixel 10 vs iPhone 17", ["pixel", "iphone"]),
    v("bbd1", "g", "Big Billion Days phone deals", ["flipkart", "sale"]),
    v("bbd2", "h", "Flipkart sale: phones to buy", ["flipkart", "sale"]),
    v("bbd3", "i", "Big Billion Days laptop offers", ["flipkart", "laptop"]),
    v("solo1", "z", "Notion tips part 1", ["notion"]),
    v("solo2", "z", "Notion tips part 2", ["notion"]),
    v("solo3", "z", "Notion tips part 3", ["notion"]),
    v("rand1", "j", "My morning routine", ["vlog"]),
    v("rand2", "k", "Street food tour Delhi", ["food"]),
    v("rand3", "l", "Cricket highlights", ["cricket"]),
  ],
  observedAt,
);

export const videosById = new Map(videos.map((x) => [x.videoId, x]));

export const goodThemes = [
  { name: "Cursor AI coding", slug: "cursor-ai-coding", video_ids: ["cur1", "cur2", "cur3", "cur4"], reason: "Cursor IDE videos" },
  { name: "Pixel 10 launch", slug: "pixel-10", video_ids: ["pix1", "pix2", "pix3"], reason: "Pixel 10 coverage" },
  { name: "Big Billion Days deals", slug: "big-billion-days", video_ids: ["bbd1", "bbd2", "bbd3"], reason: "Sale coverage" },
];
