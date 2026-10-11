// Keyword extraction for the Theme Gate's coherence check and past-theme matching (map step 9).
// A "significant keyword" is a lowercase word of 3+ letters or digits-with-letters
// (like "s26" or "gpt5") that is not on this stopword list.

// Standard English filler words, plus words that appear on almost every tech video and so
// say nothing about the topic. Without these, any two videos would look "coherent".
export const STOPWORDS = new Set([
  // English filler
  "the", "and", "for", "you", "your", "with", "this", "that", "are", "was", "but", "not", "all",
  "can", "has", "have", "had", "its", "our", "out", "how", "why", "what", "who", "when", "which",
  "from", "into", "than", "then", "them", "they", "will", "just", "now", "get", "got", "use",
  "using", "about", "after", "before", "more", "most", "very", "one", "two", "new", "here", "there",
  "should", "would", "could", "every", "only", "also", "make", "made", "know", "need", "want",
  // YouTube and tech filler
  "video", "videos", "youtube", "shorts", "short", "viral", "trending", "trend", "subscribe",
  "channel", "official", "full", "part", "episode", "live", "watch", "best", "top", "vs", "versus",
  "review", "reviews", "unboxing", "tutorial", "guide", "explained", "tips", "tricks", "hack",
  "hacks", "news", "update", "latest", "tech", "technology", "india", "indian", "hindi", "english",
  "telugu", "tamil", "malayalam", "kannada", "bangla", "marathi", "2025", "2026", "2027",
  "free", "app", "apps", "tool", "tools", "feature", "features", "ytshorts", "youtubeshorts",
  "fyp", "foryou", "reels", "shortsfeed", "kya", "hai", "aur", "kaise", "kare", "wala",
]);

export function keywords(text: string): Set<string> {
  const out = new Set<string>();
  for (const raw of text.toLowerCase().split(/[^a-z0-9]+/)) {
    if (raw.length < 3 || STOPWORDS.has(raw) || /^\d+$/.test(raw)) continue;
    out.add(raw);
  }
  return out;
}

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}
