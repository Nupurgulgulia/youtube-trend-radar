import { describe, expect, it } from "vitest";
import { clusterOutputSchema } from "@/lib/cluster";
import { generateJson, geminiGenerate, parseJsonOutput } from "@/lib/gemini";

const theme = { name: "Cursor AI coding", slug: "cursor", video_ids: ["a", "b", "c"], reason: "Same tool" };

describe("Gemini output validation (zod)", () => {
  it("accepts a valid answer", () => {
    const r = parseJsonOutput(JSON.stringify({ themes: [theme, theme, theme] }), clusterOutputSchema);
    expect(r.ok).toBe(true);
  });

  it("rejects malformed JSON", () => {
    expect(parseJsonOutput('{"themes": [', clusterOutputSchema)).toEqual({ ok: false, error: "Response was not valid JSON" });
  });

  it("rejects an empty response", () => {
    expect(parseJsonOutput(undefined, clusterOutputSchema).ok).toBe(false);
  });

  it("rejects missing fields", () => {
    const { reason: _omit, ...noReason } = theme;
    void _omit;
    const r = parseJsonOutput(JSON.stringify({ themes: [theme, theme, noReason] }), clusterOutputSchema);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("themes.2.reason");
  });

  it("rejects wrong types", () => {
    const r = parseJsonOutput(JSON.stringify({ themes: [theme, theme, { ...theme, video_ids: "a,b,c" }] }), clusterOutputSchema);
    expect(r.ok).toBe(false);
  });

  it("rejects fewer than 3 or more than 5 themes", () => {
    expect(parseJsonOutput(JSON.stringify({ themes: [theme, theme] }), clusterOutputSchema).ok).toBe(false);
    expect(parseJsonOutput(JSON.stringify({ themes: Array(6).fill(theme) }), clusterOutputSchema).ok).toBe(false);
  });
});

describe("generateJson", () => {
  it("logs a thrown SDK error without crashing", async () => {
    const r = await generateJson(
      async () => {
        throw new Error("429 Too Many Requests\nlong details");
      },
      { task: "cluster", model: "gemini-test-flash", attempt: 1 },
      { system: "s", prompt: "p", schema: {} },
      clusterOutputSchema,
    );
    expect(r.ok).toBe(false);
    expect(r.log).toMatchObject({ ok: false, error: "Gemini call failed: 429 Too Many Requests" });
  });
});

describe("Gemini Flash only", () => {
  it("refuses a model that is not Flash", () => {
    expect(() => geminiGenerate("key", "gemini-3-pro")).toThrow("must be a Gemini Flash model");
  });
});
