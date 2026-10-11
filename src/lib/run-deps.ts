import "server-only";
import { Resend } from "resend";
import { saveBrief } from "./brief-store";
import { env } from "./env";
import { geminiGenerate } from "./gemini";
import { fetchNews } from "./news";
import type { RunDeps } from "./run";
import * as runStore from "./run-store";
import * as store from "./store";
import { createYouTubeClient } from "./youtube";

// The real systems behind a run: Neon, YouTube, Google News, Gemini Flash and Resend.
export function realRunDeps(): RunDeps {
  const resend = new Resend(env("RESEND_API_KEY"));
  return {
    now: () => new Date(),
    appUrl: env("APP_URL"),
    defaultRecipient: process.env.BRIEF_TO_EMAIL?.trim() || null,
    fromEmail: env("BRIEF_FROM_EMAIL"),
    budget: {
      dailyQuota: env("YOUTUBE_DAILY_QUOTA"),
      searchDailyLimit: env("YOUTUBE_SEARCH_DAILY_LIMIT"),
      safetyMargin: env("QUOTA_SAFETY_MARGIN"),
    },
    model: env("GEMINI_MODEL"),
    maxAttempts: runStore.MAX_ATTEMPTS,
    youtube: () => createYouTubeClient({ apiKey: env("YOUTUBE_API_KEY") }),
    fetchNews: (q) => fetchNews(q),
    generate: geminiGenerate(env("GEMINI_API_KEY"), env("GEMINI_MODEL")),
    sendEmail: async ({ to, from, subject, html, text, idempotencyKey }) => {
      // The Resend SDK returns errors instead of throwing, so turn them into exceptions here.
      const { error } = await resend.emails.send({ to, from, subject, html, text }, { idempotencyKey });
      if (error) throw new Error(`Resend: ${error.name ?? "error"}: ${error.message}`);
    },
    store: {
      claimRun: runStore.claimRun,
      createLabelledRun: runStore.createLabelledRun,
      finishRun: runStore.finishRun,
      claimEmail: runStore.claimEmail,
      releaseEmail: runStore.releaseEmail,
      loadBriefContent: runStore.loadBriefContent,
      loadSettings: store.loadSettings,
      loadTrackedVideoIds: store.loadTrackedVideoIds,
      upsertVideos: store.upsertVideos,
      insertSnapshots: store.insertSnapshots,
      markUnavailable: store.markUnavailable,
      loadDayVideos: store.loadDayVideos,
      loadSnapshotHistories: store.loadSnapshotHistories,
      loadPastThemes: store.loadPastThemes,
      insertLlmLogs: store.insertLlmLogs,
      saveBrief,
    },
  };
}
