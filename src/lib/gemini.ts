import { GoogleGenAI, type Schema } from "@google/genai";
import type { z } from "zod";

// Gemini Flash wrapper (map steps 8 and 10). Gemini Flash is the only AI model in this app.
// Every call uses JSON mode with a responseSchema, and the answer is validated again
// with zod, because a schema hint is not a guarantee.

export type LlmTask = "cluster" | "write";

export type LlmLog = {
  task: LlmTask;
  model: string;
  attempt: number;
  tokensIn: number | null;
  tokensOut: number | null;
  ok: boolean;
  error: string | null;
};

export type GenerateRequest = { system: string; prompt: string; schema: Schema };
export type GenerateResponse = { text: string | undefined; tokensIn: number | null; tokensOut: number | null };
export type GenerateFn = (req: GenerateRequest) => Promise<GenerateResponse>;

export type JsonResult<T> =
  | { ok: true; data: T; log: LlmLog }
  | { ok: false; error: string; log: LlmLog };

// Real Gemini call. Tests pass a fake GenerateFn instead.
export function geminiGenerate(apiKey: string, model: string): GenerateFn {
  if (!/flash/i.test(model)) throw new Error(`GEMINI_MODEL must be a Gemini Flash model, got "${model}"`);
  const ai = new GoogleGenAI({ apiKey });
  return async ({ system, prompt, schema }) => {
    const res = await ai.models.generateContent({
      model,
      contents: prompt,
      config: {
        systemInstruction: system,
        responseMimeType: "application/json",
        responseSchema: schema,
        temperature: 0.2,
      },
    });
    const u = res.usageMetadata;
    return {
      text: res.text,
      tokensIn: u?.promptTokenCount ?? null,
      // Thinking tokens are billed as output, so they are counted here too.
      tokensOut: u ? (u.candidatesTokenCount ?? 0) + (u.thoughtsTokenCount ?? 0) : null,
    };
  };
}

// Turns raw model text into validated data, or a short error that can be sent back on retry.
export function parseJsonOutput<T>(text: string | undefined, schema: z.ZodType<T>): { ok: true; data: T } | { ok: false; error: string } {
  if (!text) return { ok: false, error: "Empty response" };
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, error: "Response was not valid JSON" };
  }
  const result = schema.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues
      .slice(0, 5)
      .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("; ");
    return { ok: false, error: `Response did not match the schema: ${issues}` };
  }
  return { ok: true, data: result.data };
}

export async function generateJson<T>(
  generate: GenerateFn,
  meta: { task: LlmTask; model: string; attempt: number },
  req: GenerateRequest,
  schema: z.ZodType<T>,
): Promise<JsonResult<T>> {
  const log: LlmLog = { ...meta, tokensIn: null, tokensOut: null, ok: false, error: null };
  let res: GenerateResponse;
  try {
    res = await generate(req);
  } catch (e) {
    // SDK errors can be long; keep the first line and never include request details.
    const error = `Gemini call failed: ${(e instanceof Error ? e.message : "unknown error").split("\n")[0].slice(0, 200)}`;
    return { ok: false, error, log: { ...log, error } };
  }
  log.tokensIn = res.tokensIn;
  log.tokensOut = res.tokensOut;
  const parsed = parseJsonOutput(res.text, schema);
  if (!parsed.ok) return { ok: false, error: parsed.error, log: { ...log, error: parsed.error } };
  return { ok: true, data: parsed.data, log: { ...log, ok: true } };
}
