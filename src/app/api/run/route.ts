import { timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";
import { isAdmin } from "@/lib/auth";
import { CATCHUP_SCHEDULE } from "@/lib/config/schedule";
import { env } from "@/lib/env";
import { runWeekly, type Trigger } from "@/lib/run";
import { realRunDeps } from "@/lib/run-deps";

// The weekly run (map step 2), shared by Vercel Cron and manual runs.
// GET  = Vercel Cron, with "Authorization: Bearer <CRON_SECRET>".
// POST = manual run, with the admin cookie or "Authorization: Bearer <ADMIN_PASSWORD>".
//        Body: { "dryRun": true } does everything except send email, under its own label.

// Hobby plan maximum, checked 2026-10-11 at vercel.com/docs/functions/configuring-functions/duration.
// A full run took about 90 seconds in testing.
export const maxDuration = 300;
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function bearerMatches(req: NextRequest, secret: string): boolean {
  const header = req.headers.get("authorization") ?? "";
  const a = Buffer.from(header);
  const b = Buffer.from(`Bearer ${secret}`);
  return a.length === b.length && timingSafeEqual(a, b);
}

const unauthorized = () => new Response("Unauthorized", { status: 401 });

export async function GET(req: NextRequest) {
  if (!bearerMatches(req, env("CRON_SECRET"))) return unauthorized();
  const trigger: Trigger = req.headers.get("x-vercel-cron-schedule") === CATCHUP_SCHEDULE ? "catchup" : "main";
  const outcome = await runWeekly(realRunDeps(), { trigger, dryRun: false });
  console.log(JSON.stringify({ route: "/api/run", trigger, ...outcome }));
  return Response.json(outcome);
}

export async function POST(req: NextRequest) {
  if (!(bearerMatches(req, env("ADMIN_PASSWORD")) || (await isAdmin()))) return unauthorized();
  const body = (await req.json().catch(() => ({}))) as { dryRun?: unknown };
  const dryRun = body.dryRun !== false; // manual runs are dry unless explicitly { "dryRun": false }
  const outcome = await runWeekly(realRunDeps(), { trigger: "manual", dryRun });
  console.log(JSON.stringify({ route: "/api/run", trigger: "manual", ...outcome }));
  return Response.json(outcome);
}
