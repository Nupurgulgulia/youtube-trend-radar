// Fake YouTube API responses for tests. Never used outside tests.

export type FakeVideo = {
  id: string;
  channel?: string;
  title?: string;
  views?: string;
  likes?: string;
  comments?: string;
  publishedAt?: string;
  duration?: string;
  tags?: string[];
};

export function videoItem(v: FakeVideo) {
  const channel = v.channel ?? "chan-a";
  return {
    id: v.id,
    snippet: {
      publishedAt: v.publishedAt ?? "2026-10-08T10:00:00Z",
      channelId: channel,
      channelTitle: `Channel ${channel}`,
      title: v.title ?? `Video ${v.id}`,
      tags: v.tags ?? ["ai", "tools"],
      categoryId: "28",
    },
    statistics: {
      ...(v.views !== undefined ? { viewCount: v.views } : {}),
      ...(v.likes !== undefined ? { likeCount: v.likes } : {}),
      ...(v.comments !== undefined ? { commentCount: v.comments } : {}),
    },
    contentDetails: { duration: v.duration ?? "PT8M30S" },
  };
}

export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

export const apiError = (status: number, reason: string) =>
  json({ error: { code: status, message: reason, errors: [{ reason }] } }, status);

type Handler = (url: URL) => Response | Promise<Response>;

// Routes requests by API path ("videos", "search", "channels") and records every URL.
export function fakeFetch(handlers: Partial<Record<string, Handler>>) {
  const calls: URL[] = [];
  const fn = async (raw: string) => {
    const url = new URL(raw);
    calls.push(url);
    const path = url.pathname.split("/").pop() as string;
    const handler = handlers[path];
    if (!handler) throw new Error(`No fake handler for ${path}`);
    return handler(url);
  };
  return { fn, calls };
}

export const noSleep = async () => {};
