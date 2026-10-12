import { timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";
import { isAdmin } from "@/lib/auth";
import { env } from "@/lib/env";
import { runResearch } from "@/lib/research";
import { parseResearchForm } from "@/lib/research-form";

// POST /api/research: start a research brief from the website. Admin only (cookie or
// "Authorization: Bearer <ADMIN_PASSWORD>"). Body: { topic, keywords?, regionCode, categoryId }.
// Runs the whole pipeline and answers when the brief is saved (about 1 to 2 minutes).

export const maxDuration = 300; // Hobby maximum, same as /api/run
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function bearerIsAdmin(req: NextRequest): boolean {
  const a = Buffer.from(req.headers.get("authorization") ?? "");
  const b = Buffer.from(`Bearer ${env("ADMIN_PASSWORD")}`);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(req: NextRequest) {
  if (!(bearerIsAdmin(req) || (await isAdmin()))) {
    return Response.json({ ok: false, needsLogin: true, error: "Please log in first." }, { status: 401 });
  }
  const body = (await req.json().catch(() => ({}))) as Record<string, string>;
  const parsed = parseResearchForm(body);
  if (!parsed.ok) return Response.json({ ok: false, error: parsed.errors.join(" ") }, { status: 400 });

  const result = await runResearch(parsed.input);
  console.log(JSON.stringify({ route: "/api/research", topic: parsed.input.topic, ...result }));
  return Response.json(result, { status: result.ok ? 200 : 422 });
}
