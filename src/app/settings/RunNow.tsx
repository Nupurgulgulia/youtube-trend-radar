"use client";

import { useState } from "react";

// Manual run buttons (map step 2, manual trigger). Uses the admin cookie, so no password
// is typed here. A dry run does everything except send email, under its own label.
export default function RunNow() {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  async function run(dryRun: boolean) {
    if (!dryRun && !confirm("Run this week's brief for real? It will send the email if this week has not been sent yet.")) return;
    setBusy(true);
    setResult("Running. This takes about 2 minutes...");
    try {
      const res = await fetch("/api/run", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ dryRun }) });
      setResult(res.ok ? JSON.stringify(await res.json(), null, 2) : `HTTP ${res.status}: ${await res.text()}`);
    } catch (e) {
      setResult(`Request failed: ${e instanceof Error ? e.message : "unknown error"}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <h2>Run now</h2>
      <p className="muted small">
        The Sunday runs start automatically. Use these to test, or to recover a missed week.
      </p>
      <p style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button type="button" onClick={() => run(true)} disabled={busy}>Dry run (no email)</button>
        <button type="button" className="primary" onClick={() => run(false)} disabled={busy}>Run this week for real</button>
      </p>
      {result && <pre className="small" style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{result}</pre>}
    </div>
  );
}
