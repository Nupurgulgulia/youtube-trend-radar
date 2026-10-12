"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { endSession, isAdmin, passwordMatches, startSession } from "@/lib/auth";
import { clearDecision, loadBrief, saveDecision, saveSettings, type Decision } from "@/lib/brief-store";
import { briefEmail, manualSendKey, maskEmail } from "@/lib/email";
import { sendWithResend } from "@/lib/email-send";
import { env } from "@/lib/env";
import { loadSettings } from "@/lib/store";
import { parseSettingsForm } from "@/lib/settings-form";

// Server actions for the forms on the brief, login and settings pages.
// Every action that changes data checks the admin session first.

const str = (fd: FormData, key: string) => String(fd.get(key) ?? "");
const safeNext = (next: string) => (next.startsWith("/") && !next.startsWith("//") ? next : "/");

export async function login(_prev: { error: string | null }, fd: FormData): Promise<{ error: string | null }> {
  if (!passwordMatches(str(fd, "password"))) return { error: "Wrong password." };
  await startSession();
  redirect(safeNext(str(fd, "next")));
}

export async function logout(): Promise<void> {
  await endSession();
  redirect("/");
}

const DECISIONS: Decision[] = ["film", "skip", "investigate"];

// Map step 14: Ishaan's decision for one theme, saved so next week can show it.
// Called from the brief page. decision = null clears it ("undecided" again).
export async function setDecision(
  weekId: string,
  slug: string,
  decision: Decision | null,
): Promise<{ ok: true } | { ok: false; needsLogin: boolean; error: string }> {
  if (!(await isAdmin())) return { ok: false, needsLogin: true, error: "Please log in first." };
  if (!weekId || !slug || (decision !== null && !DECISIONS.includes(decision))) {
    return { ok: false, needsLogin: false, error: "Invalid decision." };
  }
  if (decision === null) await clearDecision(weekId, slug);
  else await saveDecision(weekId, slug, decision, null);
  revalidatePath(`/brief/${weekId}`);
  revalidatePath("/");
  return { ok: true };
}

// Manual "Email brief" button (map step 13, sent on request). Sends the stored brief to
// the Settings email or BRIEF_TO_EMAIL. It does not touch runs.email_sent_at, so it never
// blocks or replaces the automatic Sunday email.
export async function emailBrief(
  weekId: string,
): Promise<{ ok: true; to: string } | { ok: false; needsLogin: boolean; error: string }> {
  if (!(await isAdmin())) return { ok: false, needsLogin: true, error: "Please log in first." };
  const row = await loadBrief(weekId);
  if (!row) return { ok: false, needsLogin: false, error: "That brief does not exist." };
  const settings = await loadSettings();
  const to = settings.email || process.env.BRIEF_TO_EMAIL?.trim();
  if (!to) return { ok: false, needsLogin: false, error: "No email address set. Add one on the Settings page." };
  try {
    await sendWithResend({ ...briefEmail(row.content, env("APP_URL")), to, idempotencyKey: manualSendKey(weekId, new Date()) });
  } catch (e) {
    const reason = e instanceof Error ? e.message.split("\n")[0].slice(0, 160) : "unknown error";
    return { ok: false, needsLogin: false, error: `Email failed: ${reason}` };
  }
  return { ok: true, to: maskEmail(to) };
}

export async function updateSettings(
  _prev: { errors: string[]; saved: boolean },
  fd: FormData,
): Promise<{ errors: string[]; saved: boolean }> {
  if (!(await isAdmin())) redirect("/login?next=/settings");
  const parsed = parseSettingsForm(Object.fromEntries([...fd.entries()].map(([k, v]) => [k, String(v)])));
  if (!parsed.ok) return { errors: parsed.errors, saved: false };
  await saveSettings(parsed.settings);
  revalidatePath("/settings");
  return { errors: [], saved: true };
}
