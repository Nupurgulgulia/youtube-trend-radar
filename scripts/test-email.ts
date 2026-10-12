// Sends a TEST copy of the latest real brief email through Resend.
// It does not touch runs.email_sent_at, so it never affects the weekly
// "email exactly once" rule or the next Sunday run.
// Run with: npm run email:test

import { Resend } from "resend";
import { db } from "@/lib/db";
import { briefEmail } from "@/lib/email";
import { env } from "@/lib/env";
import type { BriefContent } from "@/lib/brief";
import { loadSettings } from "@/lib/store";

async function main() {
  const [row] = await db()`
    select week_id, content from briefs
    where week_id ~ '^[0-9]{4}-W[0-9]{2}$' order by published_at desc limit 1`;
  if (!row) throw new Error("No real brief found to send.");

  const settings = await loadSettings();
  const to = settings.email || process.env.BRIEF_TO_EMAIL?.trim();
  if (!to) throw new Error("No recipient: set the Settings email or BRIEF_TO_EMAIL.");

  const msg = briefEmail(row.content as BriefContent, env("APP_URL"));
  const { data, error } = await new Resend(env("RESEND_API_KEY")).emails.send(
    {
      from: env("BRIEF_FROM_EMAIL"),
      to,
      subject: `[Test] ${msg.subject}`,
      html: msg.html,
      text: `This is a test copy. The real brief is sent automatically on Sunday mornings.\n\n${msg.text}`,
    },
    { idempotencyKey: `test-${row.week_id}-${Date.now()}` },
  );
  if (error) throw new Error(`Resend refused it: ${error.name}: ${error.message}`);

  const masked = to.replace(/^(.{2}).*(@.*)$/, "$1***$2");
  console.log(`Sent test email for ${row.week_id} to ${masked}. Resend id: ${data?.id}`);
}

main().catch((e) => {
  console.error("Test email failed:", e instanceof Error ? e.message : "Unknown error");
  process.exitCode = 1;
});
