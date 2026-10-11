import { fmtDate } from "@/lib/format";
import { listRuns } from "@/lib/run-store";

// Map step 15: every run, pass or fail, with timings, errors, coverage, quota and tokens.
// This is the "coverage report" linked from the failure email. It shows no secrets:
// error messages never include keys or request URLs.
export const dynamic = "force-dynamic";

const time = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("en-GB", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" }) + " IST" : "";

export default async function Runs() {
  const runs = await listRuns();
  return (
    <>
      <h1>Run archive</h1>
      <p className="muted">
        Every run, newest first. Real weeks look like 2026-W41. Labels starting with dryrun-, manual-collect- or preview- are tests.
      </p>
      {runs.map((r) => {
        const sr = r.sourceReport as { youtube?: { status: string; reason: string | null }; news?: { status: string; reason: string | null }; searchCalls?: number };
        const seconds = Object.entries(r.stageTimings).map(([k, v]) => `${k.replace("_ms", "")} ${Math.round(v / 100) / 10}s`);
        return (
          <section className="card" key={r.weekId}>
            <h2 style={{ fontSize: "1.05rem", wordBreak: "break-all" }}>{r.weekId}</h2>
            <div className="badges">
              <span className={`badge ${r.status === "failed" ? "low" : r.status === "running" ? "medium" : "succeeded"}`}>{r.status}</span>
              <span className="badge neutral">attempt {r.attempt}</span>
              <span className="badge neutral">{r.emailSentAt ? `email sent ${time(r.emailSentAt)}` : "no email"}</span>
            </div>
            <div className="small">
              Started {time(r.startedAt)}
              {r.finishedAt ? `, finished ${time(r.finishedAt)}` : ""}
            </div>
            {r.error && <p className="errors small">{r.error}</p>}
            <div className="small">
              Sources: YouTube {sr.youtube?.status ?? "n/a"}, news {sr.news?.status ?? "n/a"}
              {sr.youtube?.reason ? ` (${sr.youtube.reason})` : ""}
            </div>
            <div className="small">
              Quota: {r.quotaUsed} units used (estimate {r.quotaEstimated ?? "n/a"}), {sr.searchCalls ?? "n/a"} searches.
              Gemini tokens: {r.tokensIn} in, {r.tokensOut} out.
            </div>
            {seconds.length > 0 && <div className="small muted">Timings: {seconds.join(", ")}</div>}
          </section>
        );
      })}
      {runs.length === 0 && <p>No runs yet.</p>}
      <p className="muted small">Dates shown in IST. {runs[0] ? `Latest: ${fmtDate(runs[0].startedAt)}.` : ""}</p>
    </>
  );
}
