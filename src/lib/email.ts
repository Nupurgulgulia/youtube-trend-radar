import type { BriefContent } from "./brief";
import { fmtInt, momentumLabel } from "./format";

// Email content (map step 13). Plain and short: the summary, the themes, and a link to the
// full brief. No em dashes. Everything from YouTube or Gemini is HTML-escaped.

export type EmailMessage = { subject: string; html: string; text: string };

export const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

export function briefEmail(b: BriefContent, appUrl: string): EmailMessage {
  const link = `${appUrl.replace(/\/$/, "")}/brief/${encodeURIComponent(b.weekId)}`;
  const n = b.themes.length;
  const subject = b.researchTopic
    ? `Research brief: ${b.researchTopic} (${n} theme${n === 1 ? "" : "s"})`
    : `Sunday brief ${b.weekId}: ${n} theme${n === 1 ? "" : "s"}${b.status === "thin" ? " (thin week)" : ""}`;
  const themeLine = (t: BriefContent["themes"][number]) =>
    `${t.name}: ${momentumLabel[t.momentum] ?? t.momentum}, ${t.confidence} confidence, ${t.measured.creator_count} creators, median ${fmtInt(t.measured.median_views_per_day)} views per day`;

  const text = [
    subject,
    "",
    b.thinWeekNote ?? "",
    `Summary${b.summaryFromCode ? "" : " (AI, numbers checked by code)"}: ${b.executiveSummary}`,
    "",
    ...(b.topOpportunities.length ? ["Strongest opportunities:", ...b.topOpportunities.map((o) => `- ${o.name}: ${o.reason}`), ""] : []),
    "Themes:",
    ...b.themes.map((t) => `- ${themeLine(t)}`),
    "",
    `Full brief, evidence and your Film / Skip / Investigate buttons: ${link}`,
  ]
    .filter((l, i, all) => !(l === "" && all[i - 1] === ""))
    .join("\n");

  const html = `<!doctype html><html><body style="font-family:system-ui,sans-serif;line-height:1.5;color:#1c1c1a;max-width:620px">
<h2 style="margin:0 0 8px">${escapeHtml(subject)}</h2>
${b.thinWeekNote ? `<p style="border-left:4px solid #9a6200;padding:6px 10px">${escapeHtml(b.thinWeekNote)}</p>` : ""}
<p style="background:#eef3ff;border:1px solid #c9d7fb;border-radius:8px;padding:10px 12px">
<span style="font-size:12px;font-weight:600;color:#2f4fb3;text-transform:uppercase">${b.summaryFromCode ? "Summary" : "Summary (AI, numbers checked by code)"}</span><br>${escapeHtml(b.executiveSummary)}</p>
${b.topOpportunities.length ? `<h3>Strongest opportunities</h3><ul>${b.topOpportunities.map((o) => `<li><strong>${escapeHtml(o.name)}</strong>: ${escapeHtml(o.reason)}</li>`).join("")}</ul>` : ""}
<h3>Themes</h3><ul>${b.themes.map((t) => `<li>${escapeHtml(themeLine(t))}</li>`).join("")}</ul>
<p><a href="${escapeHtml(link)}" style="display:inline-block;background:#c4302b;color:#fff;padding:9px 16px;border-radius:8px;text-decoration:none">Open the full brief</a></p>
<p style="color:#62625d;font-size:13px">You make the final call. The brief recommends; it never scripts, schedules or uploads anything.</p>
</body></html>`;
  return { subject, html, text };
}

// "nupur@example.com" -> "nu***@example.com", for confirmations shown on screen.
export const maskEmail = (email: string) => email.replace(/^(.{1,2})[^@]*(@.*)$/, "$1***$2");

// Manual sends from the brief page. The key repeats within the same minute, so a
// double-click sends one email (Resend drops the repeat); a later click sends again.
export const manualSendKey = (weekId: string, now: Date) =>
  `manual-${weekId}-${Math.floor(now.getTime() / 60_000)}`;

export function failureEmail(weekId: string, reason: string, appUrl: string): EmailMessage {
  const link = `${appUrl.replace(/\/$/, "")}/runs`;
  const subject = `No brief this week (${weekId})`;
  const text = `No brief this week: ${reason}. Coverage report: ${link}`;
  const html = `<!doctype html><html><body style="font-family:system-ui,sans-serif;line-height:1.5">
<p>No brief this week: ${escapeHtml(reason)}.</p><p>Coverage report: <a href="${escapeHtml(link)}">${escapeHtml(link)}</a></p>
</body></html>`;
  return { subject, html, text };
}
