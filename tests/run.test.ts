import { describe, expect, it } from "vitest";
import type { AnalyseResult } from "@/lib/analyse";
import type { BriefContent } from "@/lib/brief";
import type { CollectionResult } from "@/lib/collector";
import type { GenerateFn } from "@/lib/gemini";
import { runWeekly, type RunDeps } from "@/lib/run";
import type { Claim } from "@/lib/run-store";
import type { VideoInput } from "@/lib/scorer";
import { createYouTubeClient } from "@/lib/youtube";
import { NO_NEWS, type ThemeEvidence } from "@/lib/write";
import { defaultSettings } from "./fixtures/settings";
import { goodThemes } from "./fixtures/themes";
import { apiError, fakeFetch, json, noSleep, videoItem } from "./fixtures/youtube";

// ---- An in-memory store with the same rules as the SQL in run-store.ts and store.ts ----

type RunRow = { runId: string; status: string; attempt: number; startedAt: number; emailSentAt: number | null; error: string | null };

function memoryStore(clock: () => Date) {
  const runs = new Map<string, RunRow>();
  const videos = new Map<string, CollectionResult["videos"][number]>();
  const snapshots = new Map<string, CollectionResult["snapshots"][number]>();
  const briefs = new Map<string, BriefContent>();
  let n = 0;

  const store: RunDeps["store"] = {
    // Same conditions as the single SQL statement in claimRun.
    claimRun: async (weekId): Promise<Claim> => {
      const now = clock().getTime();
      const r = runs.get(weekId);
      if (!r) {
        const row = { runId: `run-${++n}`, status: "running", attempt: 1, startedAt: now, emailSentAt: null, error: null };
        runs.set(weekId, row);
        return { claimed: true, runId: row.runId, attempt: 1 };
      }
      const stale = r.status === "running" && r.startedAt < now - 15 * 60_000;
      if (r.attempt < 2 && (r.status === "failed" || stale)) {
        Object.assign(r, { status: "running", attempt: r.attempt + 1, startedAt: now, error: null });
        return { claimed: true, runId: r.runId, attempt: r.attempt };
      }
      return {
        claimed: false,
        existing: {
          runId: r.runId,
          status: r.status,
          attempt: r.attempt,
          startedAt: new Date(r.startedAt).toISOString(),
          emailSentAt: r.emailSentAt ? new Date(r.emailSentAt).toISOString() : null,
        },
      };
    },
    createLabelledRun: async (label) => {
      const row = { runId: `run-${++n}`, status: "running", attempt: 1, startedAt: clock().getTime(), emailSentAt: null, error: null };
      runs.set(label, row);
      return row.runId;
    },
    finishRun: async (runId, f) => {
      const r = [...runs.values()].find((x) => x.runId === runId)!;
      Object.assign(r, { status: f.status, error: f.error });
    },
    claimEmail: async (weekId) => {
      const r = runs.get(weekId);
      if (!r || r.emailSentAt !== null) return false;
      r.emailSentAt = clock().getTime();
      return true;
    },
    releaseEmail: async (weekId, reason) => {
      const r = runs.get(weekId)!;
      r.emailSentAt = null;
      r.error = `${r.error ?? ""} Email failed: ${reason}`.trim();
    },
    loadBriefContent: async (weekId) => briefs.get(weekId) ?? null,
    loadSettings: async () => defaultSettings,
    loadTrackedVideoIds: async () => [],
    upsertVideos: async (vs) => vs.forEach((v) => videos.set(v.videoId, v)),
    // Append-only: an existing (video, day) snapshot keeps its numbers.
    insertSnapshots: async (ss) => {
      let inserted = 0;
      for (const s of ss) {
        const key = `${s.videoId}|${s.observedOn}`;
        const old = snapshots.get(key);
        if (old) old.foundBy = [...new Set([...old.foundBy, ...s.foundBy])].sort();
        else {
          snapshots.set(key, { ...s });
          inserted++;
        }
      }
      return inserted;
    },
    markUnavailable: async () => 0,
    loadDayVideos: async (day, ids): Promise<VideoInput[]> =>
      ids
        .map((id) => ({ v: videos.get(id)!, s: snapshots.get(`${id}|${day}`)! }))
        .filter((x) => x.v && x.s)
        .map(({ v, s }) => ({ ...v, views: s.views, likes: s.likes, comments: s.comments, foundBy: s.foundBy })),
    loadSnapshotHistories: async () => new Map(),
    loadPastThemes: async () => [],
    insertLlmLogs: async () => {},
    saveBrief: async (_runId, weekId, result: AnalyseResult) => void briefs.set(weekId, result.brief!),
  };
  return { store, runs, snapshots };
}

// ---- Fake outside systems ----

const fixtureVideos: [string, string, string, string[]][] = [
  ["cur1", "a", "Cursor IDE full walkthrough", ["cursor"]],
  ["cur2", "b", "Cursor vs Copilot for Indian devs", ["cursor"]],
  ["cur3", "c", "I built an app with Cursor", ["cursor"]],
  ["cur4", "d", "Cursor agent mode explained", ["cursor"]],
  ["pix1", "a", "Pixel 10 camera test", ["pixel"]],
  ["pix2", "e", "Pixel 10 battery after a week", ["pixel"]],
  ["pix3", "f", "Pixel 10 vs iPhone 17", ["pixel"]],
  ["bbd1", "g", "Big Billion Days phone deals", ["flipkart", "sale"]],
  ["bbd2", "h", "Flipkart sale: phones to buy", ["flipkart", "sale"]],
  ["bbd3", "i", "Big Billion Days laptop offers", ["flipkart", "laptop"]],
];

function youtubeFake(opts: { fail?: boolean; views?: string } = {}) {
  return fakeFetch({
    videos: () =>
      opts.fail
        ? apiError(403, "forbidden")
        : json({
            items: fixtureVideos.map(([id, channel, title, tags]) =>
              videoItem({ id, channel, title, tags, views: opts.views ?? "50000", likes: "2000", comments: "300" }),
            ),
          }),
    search: () => json({ items: [] }),
    channels: () => json({ items: [] }),
  });
}

const geminiFake: GenerateFn = async (req) => {
  if (req.prompt.startsWith("Creator's categories")) {
    return { text: JSON.stringify({ themes: goodThemes }), tokensIn: 100, tokensOut: 50 };
  }
  const evidence: ThemeEvidence[] = JSON.parse(req.prompt.slice(req.prompt.indexOf("{"))).themes;
  return {
    text: JSON.stringify({
      executive_summary: "Several creators covered a few clear topics.",
      top_opportunities: [{ slug: evidence[0].slug, reason: "Several creators are on it." }],
      themes: evidence.map((e) => ({
        slug: e.slug, momentum: e.momentum, confidence: e.confidence,
        why_this_week: "Several creators covered it.", youtube_evidence: "See the measured box.",
        news_index: null, outside_context: NO_NEWS, interpretation: "Interpretation: viewers are curious.",
        filming_angle: "A hands-on comparison for Indian buyers.", uncertain: "There is no history yet.",
      })),
    }),
    tokensIn: 200,
    tokensOut: 80,
  };
};

function setup(o: { youtubeFails?: () => boolean; emailFails?: () => boolean; at?: string } = {}) {
  let time = new Date(o.at ?? "2026-10-11T00:45:00Z");
  const clock = () => time;
  const mem = memoryStore(clock);
  const sent: { to: string; subject: string; idempotencyKey: string }[] = [];
  let youtubeCalls = 0;
  let views = "50000";
  const deps: RunDeps = {
    now: clock,
    appUrl: "https://radar.example.com",
    defaultRecipient: "ishaan@example.com",
    fromEmail: "onboarding@resend.dev",
    budget: { dailyQuota: 10_000, searchDailyLimit: 100, safetyMargin: 0.5 },
    model: "gemini-test-flash",
    maxAttempts: 2,
    youtube: () => {
      const fake = youtubeFake({ fail: o.youtubeFails?.(), views });
      return createYouTubeClient({
        apiKey: "k",
        fetchFn: async (url) => (youtubeCalls++, fake.fn(url)),
        sleep: noSleep,
      });
    },
    fetchNews: async () => [],
    generate: geminiFake,
    sendEmail: async (m) => {
      if (o.emailFails?.()) throw new Error("Resend: internal_server_error: try later");
      sent.push({ to: m.to, subject: m.subject, idempotencyKey: m.idempotencyKey });
    },
    store: mem.store,
  };
  return {
    deps,
    mem,
    sent,
    youtubeCalls: () => youtubeCalls,
    advance: (minutes: number) => (time = new Date(time.getTime() + minutes * 60_000)),
    setViews: (v: string) => (views = v),
  };
}

// ---- Tests ----

describe("weekly run", () => {
  it("runs, publishes and sends exactly one brief email", async () => {
    const t = setup();
    const r = await runWeekly(t.deps, { trigger: "main", dryRun: false });
    expect(r).toMatchObject({ action: "ran", weekId: "2026-W41", status: "succeeded", email: "sent", attempt: 1 });
    expect(t.sent).toEqual([
      { to: "ishaan@example.com", subject: "Sunday brief 2026-W41: 3 themes", idempotencyKey: "brief-2026-W41" },
    ]);
  });

  it("a second run in the same week exits without doing any work", async () => {
    const t = setup();
    await runWeekly(t.deps, { trigger: "main", dryRun: false });
    const callsAfterFirst = t.youtubeCalls();
    t.advance(180);
    const r = await runWeekly(t.deps, { trigger: "catchup", dryRun: false });
    expect(r).toEqual({ action: "skipped", weekId: "2026-W41", reason: "2026-W41 already succeeded" });
    expect(t.youtubeCalls()).toBe(callsAfterFirst);
    expect(t.sent).toHaveLength(1);
  });

  it("two deliveries of the same cron at the same moment do the work once", async () => {
    const t = setup();
    const [a, b] = await Promise.all([
      runWeekly(t.deps, { trigger: "main", dryRun: false }),
      runWeekly(t.deps, { trigger: "main", dryRun: false }),
    ]);
    expect([a.action, b.action].sort()).toEqual(["ran", "skipped"]);
    expect(t.sent).toHaveLength(1);
  });

  it("never sends the email twice, and the catch-up retries only a failed send", async () => {
    let failEmail = true;
    const t = setup({ emailFails: () => failEmail });
    const first = await runWeekly(t.deps, { trigger: "main", dryRun: false });
    expect(first).toMatchObject({ status: "succeeded", email: "failed: Resend: internal_server_error: try later" });
    expect(t.mem.runs.get("2026-W41")!.emailSentAt).toBeNull(); // claim given back
    expect(t.mem.runs.get("2026-W41")!.error).toContain("Email failed");

    failEmail = false;
    const callsBefore = t.youtubeCalls();
    const retry = await runWeekly(t.deps, { trigger: "catchup", dryRun: false });
    expect(retry).toEqual({ action: "email-retried", weekId: "2026-W41", email: "sent" });
    expect(t.youtubeCalls()).toBe(callsBefore); // no new collection

    const again = await runWeekly(t.deps, { trigger: "manual", dryRun: false });
    expect(again.action).toBe("skipped");
    expect(t.sent).toHaveLength(1);
  });

  it("a failed main run sends nothing, and a successful catch-up sends the brief", async () => {
    let youtubeDown = true;
    const t = setup({ youtubeFails: () => youtubeDown });
    const main = await runWeekly(t.deps, { trigger: "main", dryRun: false });
    expect(main).toMatchObject({ status: "failed", email: "not-sent", attempt: 1 });
    expect(t.sent).toEqual([]);

    youtubeDown = false;
    t.advance(180);
    const catchup = await runWeekly(t.deps, { trigger: "catchup", dryRun: false });
    expect(catchup).toMatchObject({ status: "succeeded", email: "sent", attempt: 2 });
    expect(t.sent.map((s) => s.idempotencyKey)).toEqual(["brief-2026-W41"]);
  });

  it("sends one short failure notice when the catch-up also fails, then stops trying", async () => {
    const t = setup({ youtubeFails: () => true });
    await runWeekly(t.deps, { trigger: "main", dryRun: false });
    t.advance(180);
    const catchup = await runWeekly(t.deps, { trigger: "catchup", dryRun: false });
    expect(catchup).toMatchObject({ status: "failed", email: "sent", attempt: 2 });
    expect(t.sent).toEqual([
      { to: "ishaan@example.com", subject: "No brief this week (2026-W41)", idempotencyKey: "failure-2026-W41" },
    ]);
    const third = await runWeekly(t.deps, { trigger: "manual", dryRun: false });
    expect(third).toMatchObject({ action: "skipped", reason: "2026-W41 already failed 2 times (limit 2)" });
  });

  it("skips while a run is in progress, but takes over a run stuck for 15+ minutes", async () => {
    const t = setup();
    await t.deps.store.claimRun("2026-W41"); // a run that started and then crashed
    t.advance(5);
    expect((await runWeekly(t.deps, { trigger: "main", dryRun: false })).action).toBe("skipped");
    t.advance(15);
    expect(await runWeekly(t.deps, { trigger: "catchup", dryRun: false })).toMatchObject({ action: "ran", attempt: 2 });
  });

  it("a dry run sends no email and leaves the week's lock alone", async () => {
    const t = setup();
    const dry = await runWeekly(t.deps, { trigger: "manual", dryRun: true });
    expect(dry).toMatchObject({ action: "ran", dryRun: true, email: "dry-run", status: "succeeded" });
    expect(dry.weekId).toMatch(/^dryrun-/);
    expect(t.sent).toEqual([]);
    expect(t.mem.runs.has("2026-W41")).toBe(false);
    const real = await runWeekly(t.deps, { trigger: "main", dryRun: false });
    expect(real).toMatchObject({ action: "ran", email: "sent" });
  });

  it("a later run on the same day never overwrites the stored snapshot numbers", async () => {
    const t = setup();
    await runWeekly(t.deps, { trigger: "manual", dryRun: true });
    const before = t.mem.snapshots.get("cur1|2026-10-11")!.views;
    t.setViews("999999");
    t.advance(60);
    await runWeekly(t.deps, { trigger: "main", dryRun: false });
    expect(t.mem.snapshots.get("cur1|2026-10-11")!.views).toBe(before);
    expect(before).toBe(50000);
  });

  it("records an error instead of crashing when no recipient is configured", async () => {
    const t = setup();
    t.deps.defaultRecipient = null;
    t.deps.store.loadSettings = async () => ({ ...defaultSettings, email: "" });
    const r = await runWeekly(t.deps, { trigger: "main", dryRun: false });
    expect(r).toMatchObject({ status: "succeeded", email: "failed: no recipient configured" });
    expect(t.mem.runs.get("2026-W41")!.emailSentAt).toBeNull();
  });
});
