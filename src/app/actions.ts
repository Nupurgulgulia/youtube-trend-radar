"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { endSession, isAdmin, passwordMatches, startSession } from "@/lib/auth";
import { saveDecision, saveSettings, type Decision } from "@/lib/brief-store";
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
export async function decide(fd: FormData): Promise<void> {
  const weekId = str(fd, "weekId");
  const slug = str(fd, "slug");
  const decision = str(fd, "decision") as Decision;
  if (!(await isAdmin())) redirect(`/login?next=${encodeURIComponent(`/brief/${weekId}`)}`);
  if (!DECISIONS.includes(decision) || !weekId || !slug) throw new Error("Invalid decision");
  const note = str(fd, "note").trim().slice(0, 500) || null;
  await saveDecision(weekId, slug, decision, note);
  revalidatePath(`/brief/${weekId}`);
  revalidatePath("/");
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
