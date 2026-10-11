import { Type, type Schema } from "@google/genai";
import { z } from "zod";
import type { ScoredVideo } from "./scorer";
import type { Settings } from "./types";

// Gemini call 1: cluster (map step 8). Gemini proposes 3 to 5 candidate themes from a
// compact list of videos. It gets no metrics, so it has no numbers to repeat or invent.

// How many videos Gemini sees: the strongest for their age first.
export const CLUSTER_CANDIDATE_LIMIT = 150;
const TAGS_PER_VIDEO = 5;

export type ProposedTheme = { name: string; slug: string; video_ids: string[]; reason: string };

export const clusterOutputSchema = z.object({
  themes: z
    .array(
      z.object({
        name: z.string().min(3).max(80),
        slug: z.string().min(1).max(80),
        video_ids: z.array(z.string().min(1)).min(1).max(30),
        reason: z.string().min(1).max(400),
      }),
    )
    .min(3)
    .max(5),
});

export const clusterResponseSchema: Schema = {
  type: Type.OBJECT,
  properties: {
    themes: {
      type: Type.ARRAY,
      minItems: "3",
      maxItems: "5",
      items: {
        type: Type.OBJECT,
        properties: {
          name: { type: Type.STRING, description: "Topic name of at most 60 characters, for example 'Cursor IDE and AI coding agents'" },
          slug: { type: Type.STRING, description: "kebab-case version of the name" },
          video_ids: { type: Type.ARRAY, items: { type: Type.STRING }, description: "IDs copied exactly from the list" },
          reason: { type: Type.STRING, description: "One sentence: what these videos have in common" },
        },
        required: ["name", "slug", "video_ids", "reason"],
        propertyOrdering: ["name", "slug", "video_ids", "reason"],
      },
    },
  },
  required: ["themes"],
};

// Fair share: every source (trending, and each keyword search) gets a turn, round-robin,
// and inside a source the strongest videos for their age go first. Without this, viral
// gadget videos fill every slot and keywords like "AI tools" never reach Gemini.
// A video found by several sources is picked once. Videos with no recorded source
// (collected before found_by existed) form one extra "unknown" source.
export function selectCandidates(videos: ScoredVideo[], limit = CLUSTER_CANDIDATE_LIMIT): ScoredVideo[] {
  const strongestFirst = (a: ScoredVideo, b: ScoredVideo) => (b.bandIndex ?? -1) - (a.bandIndex ?? -1);
  const bySource = new Map<string, ScoredVideo[]>();
  for (const v of videos) {
    const sources = v.foundBy && v.foundBy.length > 0 ? v.foundBy : ["unknown"];
    for (const s of sources) bySource.set(s, [...(bySource.get(s) ?? []), v]);
  }
  const queues = [...bySource.keys()].sort().map((s) => bySource.get(s)!.sort(strongestFirst));

  const picked = new Map<string, ScoredVideo>();
  while (picked.size < limit && queues.some((q) => q.length > 0)) {
    for (const q of queues) {
      while (q.length > 0 && picked.has(q[0].videoId)) q.shift();
      const next = q.shift();
      if (next) picked.set(next.videoId, next);
      if (picked.size >= limit) break;
    }
  }
  return [...picked.values()];
}

export const CLUSTER_SYSTEM = [
  "You group YouTube videos into topic clusters for a tech creator in India.",
  "Rules:",
  "- Propose 3 to 5 themes. Each theme is one specific topic that several different channels are covering, not a broad category like 'smartphones' or 'AI'.",
  "- Each theme needs at least 3 videos from at least 2 different channels.",
  "- Use only video IDs from the list, copied exactly. Never invent an ID.",
  "- A video may belong to at most one theme. Leave out videos that fit no theme.",
  "- Prefer topics that fit the creator's categories. Ignore giveaways, vlogs and off-topic videos.",
  "- The theme name should use words that actually appear in the titles or tags, and be at most 60 characters.",
  "- Do not mention numbers, views or popularity: you have not been given any.",
].join("\n");

export function buildClusterPrompt(videos: ScoredVideo[], settings: Settings, retryErrors: string[] = []): string {
  const lines = videos.map((v) =>
    [
      v.videoId,
      v.title.replace(/\s+/g, " ").slice(0, 120),
      `channel: ${v.channelTitle}`,
      `tags: ${v.tags.slice(0, TAGS_PER_VIDEO).join(", ") || "none"}`,
      `format: ${v.format}`,
      `length: ${v.lengthBucket}`,
      `age: ${v.ageBand}`,
    ].join(" | "),
  );
  const parts = [
    `Creator's categories: ${settings.categories.join(", ")}.`,
    `Videos (id | title | channel | tags | format | length | age):`,
    ...lines,
  ];
  if (retryErrors.length > 0) {
    parts.push(
      "",
      "Your previous answer failed these checks. Fix them and return the full answer again:",
      ...retryErrors.map((e) => `- ${e}`),
    );
  }
  return parts.join("\n");
}
