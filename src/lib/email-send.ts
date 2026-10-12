import "server-only";
import { Resend } from "resend";
import type { EmailMessage } from "./email";
import { env } from "./env";

// Sends one email through Resend (map step 13). Shared by the weekly run and the
// manual "Email brief" button, so both send in exactly the same way.
// The Resend SDK returns errors instead of throwing, so they become exceptions here.
export async function sendWithResend(msg: EmailMessage & { to: string; from?: string; idempotencyKey: string }): Promise<string | null> {
  const { data, error } = await new Resend(env("RESEND_API_KEY")).emails.send(
    { to: msg.to, from: msg.from ?? env("BRIEF_FROM_EMAIL"), subject: msg.subject, html: msg.html, text: msg.text },
    { idempotencyKey: msg.idempotencyKey },
  );
  if (error) throw new Error(`Resend: ${error.name ?? "error"}: ${error.message}`);
  return data?.id ?? null;
}
