import { z } from "zod";
import type { Settings } from "./types";

// Validates the Settings page form (map step 1). Pure code, so it can be tested.

const list = (raw: string, sep: RegExp) =>
  raw
    .split(sep)
    .map((s) => s.trim())
    .filter(Boolean);

const schema = z.object({
  categories: z.array(z.string().max(60)).min(1, "Add at least one category").max(10),
  keywords: z.array(z.string().max(60)).min(1, "Add at least one keyword").max(30, "At most 30 keywords"),
  regionCode: z.string().regex(/^[A-Z]{2}$/, "Region must be a 2-letter code such as IN"),
  relevanceLanguage: z.string().regex(/^[a-z]{2}$/, "Language must be a 2-letter code such as en"),
  categoryIds: z.array(z.number().int().positive()).max(5, "At most 5 category IDs"),
  email: z.union([z.literal(""), z.email("Email address is not valid")]),
});

export function parseSettingsForm(form: Record<string, string>): { ok: true; settings: Settings } | { ok: false; errors: string[] } {
  const ids = list(form.categoryIds ?? "", /[,\s]+/);
  if (ids.some((x) => !/^\d+$/.test(x))) return { ok: false, errors: ["Category IDs must be whole numbers, such as 28"] };
  const result = schema.safeParse({
    categories: list(form.categories ?? "", /[\n,]+/),
    keywords: [...new Set(list(form.keywords ?? "", /\n+/))], // one per line, order = priority
    regionCode: (form.regionCode ?? "").trim().toUpperCase(),
    relevanceLanguage: (form.relevanceLanguage ?? "").trim().toLowerCase(),
    categoryIds: ids.map(Number),
    email: (form.email ?? "").trim(),
  });
  if (!result.success) return { ok: false, errors: result.error.issues.map((i) => i.message) };
  return { ok: true, settings: result.data };
}
