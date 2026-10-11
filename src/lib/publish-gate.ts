import { generateJson, type GenerateFn, type LlmLog } from "./gemini";
import {
  buildWritePrompt,
  NO_NEWS,
  WRITE_SYSTEM,
  writeOutputSchema,
  writeResponseSchema,
  type ThemeEvidence,
  type WriteOutput,
  type WrittenTheme,
} from "./write";

// Publish Gate (map step 11). Code checks Gemini's writing against the evidence it was
// given. One retry with the errors; a theme that still fails is published with its
// evidence only and the note below. The rules are never relaxed.

export const WRITTEN_FAILED_NOTE = "Written summary failed checks.";
// A written number matches an evidence number within this relative difference (rounding)...
export const NUMBER_TOLERANCE = 0.02;
// ...or within this absolute difference, for small numbers like 2.95 written as 3.
export const NUMBER_ABS_TOLERANCE = 0.5;

const MULTIPLIERS: Record<string, number> = { k: 1e3, thousand: 1e3, lakh: 1e5, m: 1e6, million: 1e6, crore: 1e7 };
const RISING_WORDS = /\b(rising|rise|rises|surg\w*|accelerat\w*|growing|grows|taking off|picking up|gaining momentum|on the rise|booming|skyrocket\w*|exploding)\b/i;
const FADING_WORDS = /\b(fading|fades|declin\w*|cooling|losing steam|dying|slowing down|waning|dropping off)\b/i;

// ---- Allowed values, collected from the evidence ----

type Allowed = { numbers: number[]; text: string; links: Set<string>; dates: Set<string> };

// Dates are checked as whole dates, never as loose numbers: otherwise "2026-10-09" would
// make any stray 9 or 10 look like evidence, and a wrong date could slip through.
const ISO_DATE = /\b(\d{4})-(\d{2})-(\d{2})\b/g;
const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
const MONTH = `(${MONTHS.join("|")}|${MONTHS.map((m) => m.slice(0, 3)).join("|")})`;
const DAY_MONTH = new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+${MONTH}\\b(?:,?\\s+(\\d{4}))?`, "gi");
const MONTH_DAY = new RegExp(`\\b${MONTH}\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b(?:,?\\s+(\\d{4}))?`, "gi");

const monthNumber = (name: string) => String(MONTHS.findIndex((m) => m.startsWith(name.toLowerCase().slice(0, 3))) + 1).padStart(2, "0");

// Pulls every date out of the text. Returns the dates (as YYYY-MM-DD, or MM-DD when no
// year was written) and the text with those dates removed.
export function extractDates(text: string): { dates: string[]; rest: string } {
  const dates: string[] = [];
  let rest = text.replace(ISO_DATE, (m) => (dates.push(m), " "));
  rest = rest.replace(DAY_MONTH, (_m, d, mon, y) => (dates.push(`${y ? `${y}-` : ""}${monthNumber(mon)}-${String(d).padStart(2, "0")}`), " "));
  rest = rest.replace(MONTH_DAY, (_m, mon, d, y) => (dates.push(`${y ? `${y}-` : ""}${monthNumber(mon)}-${String(d).padStart(2, "0")}`), " "));
  return { dates, rest };
}

function walk(value: unknown, numbers: number[], strings: string[]) {
  if (typeof value === "number") numbers.push(value);
  else if (typeof value === "string") strings.push(value);
  else if (Array.isArray(value)) value.forEach((v) => walk(v, numbers, strings));
  else if (value && typeof value === "object") Object.values(value).forEach((v) => walk(v, numbers, strings));
}

export function allowedFrom(evidence: ThemeEvidence[], extra: string[] = []): Allowed {
  const numbers: number[] = [];
  const strings: string[] = [...extra];
  walk(evidence, numbers, strings);
  // Dates are collected whole. Other numbers inside titles and headlines (e.g. "Pixel 10")
  // are allowed too, but the parts of a date are not.
  const dates = new Set<string>();
  for (const str of strings) {
    const { dates: found, rest } = extractDates(str);
    for (const d of found) {
      dates.add(d);
      if (d.length === 10) dates.add(d.slice(5)); // also allow the same day written without a year
    }
    for (const t of extractNumberTokens(rest)) if (t.kind === "number") numbers.push(t.value);
  }
  const links = new Set<string>();
  for (const e of evidence) {
    e.videos.forEach((v) => links.add(v.link));
    e.news.forEach((n) => links.add(n.link));
  }
  return { numbers, text: strings.join(" \n ").toLowerCase(), links, dates };
}

// ---- Number extraction ----

type NumberToken = { kind: "number"; value: number; raw: string } | { kind: "code"; raw: string };

export function extractNumberTokens(text: string): NumberToken[] {
  const out: NumberToken[] = [];
  const tokens = text.match(/[A-Za-z0-9][A-Za-z0-9.,%]*/g) ?? [];
  for (let i = 0; i < tokens.length; i++) {
    const raw = tokens[i].replace(/[.,]+$/, "");
    if (!/\d/.test(raw)) continue;
    let m: RegExpMatchArray | null;
    if ((m = raw.match(/^(\d{1,3}(?:,\d{2,3})+|\d+)(?:\.(\d+))?$/))) {
      let value = Number(`${m[1].replace(/,/g, "")}${m[2] ? `.${m[2]}` : ""}`);
      const unit = tokens[i + 1]?.toLowerCase().replace(/[.,]+$/, "");
      if (unit && MULTIPLIERS[unit] && unit !== "m" && unit !== "k") value *= MULTIPLIERS[unit];
      out.push({ kind: "number", value, raw });
    } else if ((m = raw.match(/^(\d+(?:\.\d+)?)(k|m|x|%)$/i))) {
      const suffix = m[2].toLowerCase();
      const mult = suffix === "k" || suffix === "m" ? MULTIPLIERS[suffix] : 1;
      out.push({ kind: "number", value: Number(m[1]) * mult, raw });
    } else {
      // Mixed tokens such as "V80", "144Hz", "S26" or "4K": they must appear in the evidence.
      out.push({ kind: "code", raw });
    }
  }
  return out;
}

const numberAllowed = (v: number, allowed: number[]) =>
  allowed.some((a) => Math.abs(v - a) <= Math.max(NUMBER_ABS_TOLERANCE, NUMBER_TOLERANCE * Math.abs(a)));

// ---- Checks ----

function checkText(label: string, text: string, allowed: Allowed): string[] {
  const errors: string[] = [];
  const { dates, rest } = extractDates(text.replace(/https?:\/\/[^\s)"'\]]+/g, " "));
  for (const d of dates) {
    if (!allowed.dates.has(d)) errors.push(`${label}: the date ${d} is not in the evidence`);
  }
  for (const t of extractNumberTokens(rest)) {
    if (t.kind === "number" && !numberAllowed(t.value, allowed.numbers)) {
      errors.push(`${label}: the number "${t.raw}" is not in the evidence`);
    }
    if (t.kind === "code" && !allowed.text.includes(t.raw.toLowerCase())) {
      errors.push(`${label}: "${t.raw}" does not appear in the evidence`);
    }
  }
  for (const url of text.match(/https?:\/\/[^\s)"'\]]+/g) ?? []) {
    if (!allowed.links.has(url.replace(/[.,]+$/, ""))) errors.push(`${label}: the link ${url} is not in the evidence`);
  }
  // Quoted titles or headlines must be real.
  for (const m of text.matchAll(/["â€œ]([^"â€]{12,})["â€]/g)) {
    if (!allowed.text.includes(m[1].toLowerCase().trim())) {
      errors.push(`${label}: the quoted text "${m[1].slice(0, 60)}" is not a title or headline from the evidence`);
    }
  }
  return errors;
}

function checkDirection(label: string, text: string, momentum: string): string[] {
  if (momentum !== "rising" && RISING_WORDS.test(text)) {
    return [`${label}: describes the topic as rising or accelerating, but momentum is '${momentum}'`];
  }
  if (momentum !== "fading" && FADING_WORDS.test(text)) {
    return [`${label}: describes the topic as fading or declining, but momentum is '${momentum}'`];
  }
  return [];
}

const TEXT_FIELDS = ["why_this_week", "youtube_evidence", "outside_context", "interpretation", "filming_angle", "uncertain"] as const;

export function checkWrittenTheme(w: WrittenTheme | undefined, e: ThemeEvidence, extra: string[] = []): string[] {
  const t = `theme '${e.slug}'`;
  if (!w) return [`${t}: missing from the answer`];
  const errors: string[] = [];
  if (w.momentum !== e.momentum) errors.push(`${t}: momentum changed from '${e.momentum}' to '${w.momentum}'`);
  if (w.confidence !== e.confidence) errors.push(`${t}: confidence changed from '${e.confidence}' to '${w.confidence}'`);

  const allowed = allowedFrom([e], extra);
  for (const f of TEXT_FIELDS) {
    errors.push(...checkText(`${t} ${f}`, w[f], allowed));
    errors.push(...checkDirection(`${t} ${f}`, w[f], e.momentum));
  }

  if (w.news_index === null) {
    if (w.outside_context.trim() !== NO_NEWS) {
      errors.push(`${t} outside_context: with no news item chosen it must be exactly "${NO_NEWS}"`);
    }
  } else if (!e.news.some((n) => n.index === w.news_index)) {
    errors.push(`${t}: news_index ${w.news_index} does not exist (${e.news.length} news items were given)`);
  } else if (w.outside_context.trim() === NO_NEWS) {
    errors.push(`${t}: a news item was chosen but outside_context says "${NO_NEWS}"`);
  }
  return errors;
}

export function checkSummary(out: WriteOutput, evidence: ThemeEvidence[], extra: string[] = []): string[] {
  const allowed = allowedFrom(evidence, extra);
  const slugs = new Set(evidence.map((e) => e.slug));
  const errors = checkText("executive_summary", out.executive_summary, allowed);
  // The summary covers several themes, so only directions no theme supports are refused.
  if (!evidence.some((e) => e.momentum === "rising") && RISING_WORDS.test(out.executive_summary)) {
    errors.push("executive_summary: describes something as rising, but no theme is rising");
  }
  if (!evidence.some((e) => e.momentum === "fading") && FADING_WORDS.test(out.executive_summary)) {
    errors.push("executive_summary: describes something as fading, but no theme is fading");
  }
  for (const o of out.top_opportunities) {
    if (!slugs.has(o.slug)) errors.push(`top_opportunities: unknown theme '${o.slug}'`);
    const e = evidence.find((x) => x.slug === o.slug);
    errors.push(...checkText(`top_opportunities '${o.slug}'`, o.reason, allowed));
    if (e) errors.push(...checkDirection(`top_opportunities '${o.slug}'`, o.reason, e.momentum));
  }
  return errors;
}

// No em dashes in user-facing text (CLAUDE.md rule 6). Fixed in code, not by retrying.
export const noEmDash = (s: string) => s.replace(/\s*â€”\s*/g, ", ");

function clean(w: WrittenTheme): WrittenTheme {
  const out = { ...w };
  for (const f of TEXT_FIELDS) out[f] = noEmDash(out[f]);
  return out;
}

// ---- The full step: write, check, one retry, fall back ----

export type PublishResult = {
  written: Map<string, WrittenTheme | null>; // null = evidence only, with WRITTEN_FAILED_NOTE
  executiveSummary: string;
  summaryFromCode: boolean; // true when Gemini's summary failed and a plain factual one was used
  topOpportunities: { slug: string; reason: string }[];
  errors: string[]; // what still failed after the retry
  logs: LlmLog[];
};

// Factual fallback built only from the evidence, used if Gemini's summary fails twice.
function codeSummary(evidence: ThemeEvidence[]): string {
  const names = evidence.map((e) => `${e.name} (${e.momentum.replace("_", " ")}, ${e.confidence} confidence)`);
  return `This week ${evidence.length} theme${evidence.length === 1 ? "" : "s"} passed the checks: ${names.join("; ")}.`;
}

export async function runPublishGate(deps: {
  generate: GenerateFn;
  model: string;
  weekId: string;
  evidence: ThemeEvidence[];
}): Promise<PublishResult> {
  const logs: LlmLog[] = [];
  const ask = async (attempt: number, retryErrors: string[]) => {
    const res = await generateJson(
      deps.generate,
      { task: "write", model: deps.model, attempt },
      { system: WRITE_SYSTEM, prompt: buildWritePrompt(deps.evidence, deps.weekId, retryErrors), schema: writeResponseSchema },
      writeOutputSchema,
    );
    logs.push(res.log);
    return res;
  };

  const evaluate = (out: WriteOutput | null) => {
    const perTheme = new Map<string, string[]>();
    for (const e of deps.evidence) {
      const w = out?.themes.find((x) => x.slug === e.slug);
      perTheme.set(e.slug, out ? checkWrittenTheme(w, e, [deps.weekId]) : ["no usable answer"]);
    }
    const summaryErrors = out ? checkSummary(out, deps.evidence, [deps.weekId]) : ["no usable answer"];
    return { perTheme, summaryErrors };
  };

  const first = await ask(1, []);
  const out1 = first.ok ? first.data : null;
  const eval1 = evaluate(out1);
  const errors1 = first.ok ? [...[...eval1.perTheme.values()].flat(), ...eval1.summaryErrors] : [first.error];

  let out2: WriteOutput | null = null;
  let eval2 = eval1;
  if (errors1.length > 0) {
    const second = await ask(2, errors1);
    out2 = second.ok ? second.data : null;
    eval2 = evaluate(out2);
  }

  // Per theme, use whichever attempt passed (the retry first, then the original).
  const written = new Map<string, WrittenTheme | null>();
  const remaining: string[] = [];
  for (const e of deps.evidence) {
    const pick = (out: WriteOutput | null, ev: typeof eval1) =>
      out && ev.perTheme.get(e.slug)!.length === 0 ? out.themes.find((x) => x.slug === e.slug)! : null;
    const w = (out2 ? pick(out2, eval2) : null) ?? pick(out1, eval1);
    written.set(e.slug, w ? clean(w) : null);
    if (!w) remaining.push(...(out2 ? eval2 : eval1).perTheme.get(e.slug)!);
  }

  const summarySource = out2 && eval2.summaryErrors.length === 0 ? out2 : out1 && eval1.summaryErrors.length === 0 ? out1 : null;
  if (!summarySource) remaining.push(...(out2 ? eval2 : eval1).summaryErrors);

  return {
    written,
    executiveSummary: summarySource ? noEmDash(summarySource.executive_summary) : codeSummary(deps.evidence),
    summaryFromCode: summarySource === null,
    topOpportunities: summarySource ? summarySource.top_opportunities.map((o) => ({ ...o, reason: noEmDash(o.reason) })) : [],
    errors: remaining,
    logs,
  };
}

// ---- Outcome ----

export type Outcome = "succeeded" | "thin" | "failed";

export function decideOutcome(collectionFailed: boolean, themesPassed: number): Outcome {
  if (collectionFailed || themesPassed === 0) return "failed";
  return themesPassed <= 2 ? "thin" : "succeeded";
}
