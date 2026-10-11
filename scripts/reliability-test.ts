// Live check of the lock and email-once SQL against the real database (checkpoint 9).
// Uses a "test-lock-..." label, never a real ISO week. Sends no email.
// Run with: npm run reliability:test

import { claimEmail, claimRun, finishRun, releaseEmail } from "@/lib/run-store";

async function main() {
  const label = `test-lock-${new Date().toISOString()}`;
  const check = (name: string, ok: boolean) => console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);

  // Two claims at the same moment: exactly one may win.
  const [a, b] = await Promise.all([claimRun(label), claimRun(label)]);
  check("two simultaneous claims: exactly one wins", [a.claimed, b.claimed].filter(Boolean).length === 1);

  const third = await claimRun(label);
  check("a third claim while running (under 15 minutes) is refused", !third.claimed && third.existing?.status === "running");

  const winner = a.claimed ? a : b.claimed ? b : null;
  if (!winner || !winner.claimed) throw new Error("no claim won");
  await finishRun(winner.runId, {
    status: "failed", error: "test failure", sourceReport: {}, stageTimings: {},
    quotaEstimated: null, quotaUsed: 0, tokensIn: 0, tokensOut: 0,
  });
  const retry = await claimRun(label);
  check("after a failure, one retry is allowed (attempt 2)", retry.claimed && retry.attempt === 2);
  if (retry.claimed) {
    await finishRun(retry.runId, {
      status: "failed", error: "test failure 2", sourceReport: {}, stageTimings: {},
      quotaEstimated: null, quotaUsed: 0, tokensIn: 0, tokensOut: 0,
    });
  }
  const fourth = await claimRun(label);
  check("after 2 failed attempts, no more claims", !fourth.claimed && fourth.existing?.attempt === 2);

  // Email once.
  const [e1, e2] = await Promise.all([claimEmail(label), claimEmail(label)]);
  check("two simultaneous email claims: exactly one wins", [e1, e2].filter(Boolean).length === 1);
  check("a later email claim is refused", !(await claimEmail(label)));
  await releaseEmail(label, "simulated Resend outage");
  check("after a failed send is released, the email can be claimed again", await claimEmail(label));
  check("and only once", !(await claimEmail(label)));

  console.log(`\nTest rows are labelled ${label} in the runs table.`);
}

main().catch((e) => {
  console.error("Reliability test failed:", e instanceof Error ? e.message.split("\n")[0] : "Unknown error");
  process.exit(1);
});
