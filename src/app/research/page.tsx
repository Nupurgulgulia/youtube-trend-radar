import Link from "next/link";
import { isResearch, listBriefs } from "@/lib/brief-store";
import { fmtDate } from "@/lib/format";

// Research briefs: the same pipeline as the Sunday brief, run on request with its own
// topic and keywords (npm run research -- <config.json>). Newest first.
export const dynamic = "force-dynamic";

export default async function Research() {
  const research = (await listBriefs()).filter((b) => isResearch(b.weekId));
  return (
    <>
      <h1>Research briefs</h1>
      <p className="muted">
        Run on request with their own keywords, using the same data, quality checks and AI rules as the Sunday brief.
        They are not part of the Sunday brief and are not emailed automatically.
      </p>
      {research.length === 0 ? (
        <p className="muted">No research briefs yet.</p>
      ) : (
        research.map((b) => (
          <Link key={b.weekId} href={`/brief/${encodeURIComponent(b.weekId)}`} className="card research-card">
            <span className="pill pill-mom-established">RESEARCH</span>
            <h2>{b.researchTopic ?? b.weekId}</h2>
            <p className="dim small">
              {b.themeCount} {b.themeCount === 1 ? "theme" : "themes"} · {b.status === "thin" ? "Thin" : "Succeeded"} · {fmtDate(b.publishedAt)}
            </p>
          </Link>
        ))
      )}
    </>
  );
}
