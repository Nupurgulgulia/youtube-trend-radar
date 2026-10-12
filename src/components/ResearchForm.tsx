"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CATEGORIES, MAX_RESEARCH_KEYWORDS, REGIONS } from "@/lib/research-form";

// "Start research" form. Sends the topic to /api/research, shows progress while the
// pipeline runs (about 1 to 2 minutes), then opens the finished research brief.

const STEPS = [
  { at: 0, text: "Searching YouTube and Google News..." },
  { at: 12, text: "Measuring views per day, engagement, formats and lengths..." },
  { at: 20, text: "Gemini Flash is grouping videos into topics (Theme Gate checks every one)..." },
  { at: 45, text: "Gemini Flash is writing the brief (Publish Gate checks every number and link)..." },
  { at: 100, text: "Almost done, saving the brief..." },
];

export default function ResearchForm({ isAdmin, defaultRegion }: { isAdmin: boolean; defaultRegion: string }) {
  const router = useRouter();
  const [topic, setTopic] = useState("");
  const [keywords, setKeywords] = useState("");
  const [regionCode, setRegionCode] = useState(REGIONS.some((r) => r.code === defaultRegion) ? defaultRegion : "IN");
  const [categoryId, setCategoryId] = useState("0");
  const [running, setRunning] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => () => { if (timer.current) clearInterval(timer.current); }, []);

  if (!isAdmin) {
    return (
      <div className="card research-form">
        <h2>Start a new research</h2>
        <p className="dim">Research uses YouTube quota and Gemini, so it needs the admin login.</p>
        <a className="btn-primary" href="/login?next=/research">Log in to start a research</a>
      </div>
    );
  }

  const start = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setRunning(true);
    setElapsed(0);
    const t0 = Date.now();
    timer.current = setInterval(() => setElapsed(Math.floor((Date.now() - t0) / 1000)), 1000);
    try {
      const res = await fetch("/api/research", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ topic, keywords, regionCode, categoryId }),
      });
      const data = await res.json().catch(() => ({ ok: false, error: `Server answered HTTP ${res.status}` }));
      if (data.ok) {
        router.push(`/brief/${encodeURIComponent(data.label)}`);
        return;
      }
      if (data.needsLogin) {
        router.push("/login?next=/research");
        return;
      }
      setError(data.error ?? "Research failed.");
    } catch {
      setError("The connection dropped. The research may still finish: check this page again in two minutes.");
    } finally {
      if (timer.current) clearInterval(timer.current);
      setRunning(false);
    }
  };

  if (running) {
    const step = [...STEPS].reverse().find((s) => elapsed >= s.at)!;
    return (
      <div className="card research-form research-running" role="status" aria-live="polite">
        <span className="pulse" aria-hidden />
        <h2>Researching “{topic}”</h2>
        <p>{step.text}</p>
        <p className="dim small mono">{elapsed}s elapsed · usually 60 to 120 seconds · keep this tab open</p>
        <div className="progress"><span style={{ width: `${Math.min(95, (elapsed / 110) * 100)}%` }} /></div>
      </div>
    );
  }

  return (
    <form className="card research-form" onSubmit={start} id="new">
      <h2>Start a new research</h2>
      <p className="dim small">
        Type any topic. The app searches live YouTube and Google News, finds what several creators are covering,
        checks every number, and publishes a research brief here and on the home page.
      </p>

      <label htmlFor="r-topic">Topic</label>
      <input id="r-topic" type="text" required minLength={3} maxLength={80} value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="e.g. PS5 jailbreak, iPhone 18 leaks, AI video editing tools" />

      <label htmlFor="r-keywords">
        YouTube searches <span className="muted">(optional, one per line, up to {MAX_RESEARCH_KEYWORDS}. Leave empty to search the topic itself.)</span>
      </label>
      <textarea id="r-keywords" rows={3} value={keywords} onChange={(e) => setKeywords(e.target.value)} placeholder={"PS5 jailbreak\nPS5 homebrew\nPS5 emulators"} />

      <div className="form-row">
        <div>
          <label htmlFor="r-region">Region</label>
          <select id="r-region" value={regionCode} onChange={(e) => setRegionCode(e.target.value)}>
            {REGIONS.map((r) => <option key={r.code} value={r.code}>{r.label}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="r-category">Trending category</label>
          <select id="r-category" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
            {CATEGORIES.map((c) => <option key={c.id} value={String(c.id)}>{c.label}</option>)}
          </select>
        </div>
      </div>

      {error && <p className="errors" role="alert">{error}</p>}
      <p style={{ marginTop: 16 }}>
        <button type="submit" className="btn-primary">🔎 Start research</button>
      </p>
      <p className="dim small">Takes about 1 to 2 minutes. Uses up to {MAX_RESEARCH_KEYWORDS} YouTube searches. It never changes the Sunday brief or its email.</p>
    </form>
  );
}
