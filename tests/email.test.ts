import { describe, expect, it } from "vitest";
import type { BriefContent } from "@/lib/brief";
import { briefEmail, escapeHtml, failureEmail } from "@/lib/email";

const brief = {
  weekId: "2026-W42",
  status: "thin",
  generatedAt: "2026-10-18T01:00:00.000Z",
  executiveSummary: "One topic <b>stood out</b>.",
  summaryFromCode: false,
  thinWeekNote: "Thin week: fewer than 3 themes passed the quality checks. Nothing was added to fill the gap.",
  topOpportunities: [{ slug: "cursor", name: "Cursor AI coding", reason: "4 creators are covering it." }],
  themes: [
    {
      slug: "cursor",
      name: "Cursor AI coding",
      momentum: "established",
      confidence: "medium",
      measured: { creator_count: 4, median_views_per_day: 138859 },
    },
  ],
} as unknown as BriefContent;

describe("brief email", () => {
  const m = briefEmail(brief, "https://radar.example.com/");

  it("has a clear subject, the thin-week note and a link to the full brief", () => {
    expect(m.subject).toBe("Sunday brief 2026-W42: 1 theme (thin week)");
    expect(m.text).toContain("Thin week:");
    expect(m.text).toContain("https://radar.example.com/brief/2026-W42");
    expect(m.text).toContain("Cursor AI coding: Established, medium confidence, 4 creators, median 1,38,859 views per day");
  });

  it("escapes HTML coming from YouTube or Gemini", () => {
    expect(m.html).toContain("One topic &lt;b&gt;stood out&lt;/b&gt;.");
    expect(m.html).not.toContain("<b>stood out</b>");
  });

  it("contains no em dashes", () => {
    expect(m.html + m.text + m.subject).not.toContain("—");
  });
});

describe("failure email", () => {
  it("says why and links to the coverage report, nothing more", () => {
    const m = failureEmail("2026-W42", "YouTube collection failed: quota exceeded", "https://radar.example.com");
    expect(m.subject).toBe("No brief this week (2026-W42)");
    expect(m.text).toBe("No brief this week: YouTube collection failed: quota exceeded. Coverage report: https://radar.example.com/runs");
  });
});

describe("escapeHtml", () => {
  it("escapes the five special characters", () => {
    expect(escapeHtml(`<a href="x">'&'</a>`)).toBe("&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;");
  });
});
