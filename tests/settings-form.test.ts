import { describe, expect, it } from "vitest";
import { parseSettingsForm } from "@/lib/settings-form";

const form = {
  categories: "AI tools, Productivity apps\nTech reviews",
  keywords: "AI tools\nChatGPT\n\nAI tools\nlaptop review",
  regionCode: "in",
  relevanceLanguage: "EN",
  categoryIds: "28, 24",
  email: "ishaan@example.com",
};

describe("parseSettingsForm", () => {
  it("cleans up and keeps keyword order as priority", () => {
    const r = parseSettingsForm(form);
    expect(r).toEqual({
      ok: true,
      settings: {
        categories: ["AI tools", "Productivity apps", "Tech reviews"],
        keywords: ["AI tools", "ChatGPT", "laptop review"],
        regionCode: "IN",
        relevanceLanguage: "en",
        categoryIds: [28, 24],
        email: "ishaan@example.com",
      },
    });
  });

  it("allows an empty email and no category IDs", () => {
    expect(parseSettingsForm({ ...form, email: "", categoryIds: "" }).ok).toBe(true);
  });

  it("rejects bad input with readable messages", () => {
    const r = parseSettingsForm({ ...form, regionCode: "India", keywords: "", email: "nope" });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors).toContain("Region must be a 2-letter code such as IN");
      expect(r.errors).toContain("Add at least one keyword");
      expect(r.errors).toContain("Email address is not valid");
    }
  });

  it("rejects non-numeric category IDs", () => {
    expect(parseSettingsForm({ ...form, categoryIds: "28, tech" })).toEqual({
      ok: false,
      errors: ["Category IDs must be whole numbers, such as 28"],
    });
  });
});
