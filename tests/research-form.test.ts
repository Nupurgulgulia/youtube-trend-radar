import { describe, expect, it } from "vitest";
import { defaultKeywords, parseResearchForm, researchLabel, searchBudgetCheck, SUNDAY_SEARCH_RESERVE } from "@/lib/research-form";

describe("parseResearchForm", () => {
  it("uses typed keywords, dedupes them and keeps their order", () => {
    const r = parseResearchForm({ topic: "  PS5   jailbreak ", keywords: "PS5 jailbreak\nPS5 homebrew, PS5 jailbreak\n\n", regionCode: "us", categoryId: "20" });
    expect(r).toEqual({ ok: true, input: { topic: "PS5 jailbreak", keywords: ["PS5 jailbreak", "PS5 homebrew"], regionCode: "US", categoryIds: [20] } });
  });

  it("searches the topic itself when no keywords are given", () => {
    const r = parseResearchForm({ topic: "iPhone 18", keywords: "", regionCode: "IN", categoryId: "0" });
    expect(r).toEqual({ ok: true, input: { topic: "iPhone 18", keywords: defaultKeywords("iPhone 18"), regionCode: "IN", categoryIds: [] } });
  });

  it("rejects bad input with readable messages", () => {
    const r = parseResearchForm({ topic: "ab", keywords: "a\nb\nc\nd\ne\nf", regionCode: "XX", categoryId: "99" });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors).toContain("Topic needs at least 3 characters");
      expect(r.errors).toContain("At most 5 keywords");
      expect(r.errors).toContain("Pick a region from the list");
      expect(r.errors).toContain("Pick a category from the list");
    }
  });
});

describe("researchLabel", () => {
  it("is readable, URL-safe and unique per minute", () => {
    expect(researchLabel("PS5 jailbreak & ports!", new Date("2026-10-12T18:30:45Z"))).toBe("research-ps5-jailbreak-ports-20261012-1830");
  });
});

describe("searchBudgetCheck", () => {
  it("allows research that leaves the Sunday reserve intact", () => {
    expect(searchBudgetCheck(10, 5, 100)).toBeNull();
    expect(searchBudgetCheck(100 - SUNDAY_SEARCH_RESERVE - 5, 5, 100)).toBeNull();
  });

  it("refuses research that would eat into the Sunday reserve", () => {
    const msg = searchBudgetCheck(100 - SUNDAY_SEARCH_RESERVE - 4, 5, 100);
    expect(msg).toContain("kept for the Sunday brief");
  });
});
