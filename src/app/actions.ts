"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { endSession, isAdmin, passwordMatches, startSession } from "@/lib/auth";
import { clearDecision, saveDecision, saveSettings, type Decision } from "@/lib/brief-store";
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
// Called from the brief page. decision = null clears it ("needs triage" again).
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
