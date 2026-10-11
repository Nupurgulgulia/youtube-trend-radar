// Video format rules (map step 7). Transparent keyword rules, checked in this order;
// the first format with a matching pattern wins. Gemini never classifies formats.
// The title is checked first. Only if the title matches nothing are the tags checked.
// Titles in other languages or without these words fall into "other": that is a known gap.

export const FORMATS = ["comparison", "review", "tutorial", "list", "news_reaction", "explainer", "other"] as const;
export type Format = (typeof FORMATS)[number];

export const FORMAT_RULES: { format: Exclude<Format, "other">; patterns: RegExp[] }[] = [
  {
    format: "comparison",
    patterns: [
      /\bvs\.?\b/,
      /\bversus\b/,
      /\bcompar(e|ed|ison)\b/,
      /\bbetter than\b/,
      /\bwhich (one )?(is|should)\b/,
      /\bwhich\b[^?]*\b(best|better|smartest|fastest|cheapest)\b/,
    ],
  },
  {
    format: "review",
    patterns: [/\breview\b/, /\bunboxing\b/, /\bhands[- ]on\b/, /\bworth it\b/, /\bhonest opinion\b/, /\blong[- ]term\b/],
  },
  {
    format: "tutorial",
    // "setup" is deliberately not here: real titles like "desk setup" or "LED light setup" are not tutorials.
    patterns: [/\bhow to\b/, /\btutorial\b/, /\bguide\b/, /\bstep[- ]by[- ]step\b/, /\bfor beginners\b/, /\bcourse\b/],
  },
  {
    format: "list",
    patterns: [/\b(top|best)\s+\d+\b/, /\b\d+\s+(best|ai|apps?|tools?|tips|ways|features|things|websites)\b/],
  },
  {
    format: "news_reaction",
    patterns: [/\bnews\b/, /\blaunch(ed|es)?\b/, /\bannounc(ed|es|ement)\b/, /\bleak(s|ed)?\b/, /\breact(ion|s)?\b/, /\bjust dropped\b/, /\bis here\b/, /\bbreaking\b/],
  },
  {
    format: "explainer",
    patterns: [/\bexplained\b/, /\bwhat is\b/, /\bhow does\b/, /\bwhy\b/, /\beverything you need to know\b/, /\bthe truth\b/],
  },
];

function match(text: string): Format | null {
  const t = text.toLowerCase();
  for (const rule of FORMAT_RULES) {
    if (rule.patterns.some((p) => p.test(t))) return rule.format;
  }
  return null;
}

export function classifyFormat(title: string, tags: string[]): Format {
  return match(title) ?? match(tags.join(" | ")) ?? "other";
}
