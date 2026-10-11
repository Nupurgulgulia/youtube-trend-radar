import type { Settings } from "@/lib/types";

// Same starting values as the settings row seeded by db/migrations/0001_init.sql.
export const defaultSettings: Settings = {
  categories: ["AI tools", "Productivity apps", "Tech reviews"],
  keywords: ["AI tools", "AI coding", "ChatGPT", "productivity apps", "smartphone review", "laptop review"],
  regionCode: "IN",
  relevanceLanguage: "en",
  categoryIds: [28],
  email: "ishaan@example.com",
};
