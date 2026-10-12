import Link from "next/link";
import ResearchForm from "@/components/ResearchForm";
import { isAdmin } from "@/lib/auth";
import { isResearch, listBriefs } from "@/lib/brief-store";
import { fmtDate } from "@/lib/format";
import { loadSettings } from "@/lib/store";

// Research: start a new research brief from the website, and read past ones (newest first).
export const dynamic = "force-dynamic";

export default async function Research() {
  const [briefs, admin, settings] = await Promise.all([listBriefs(), isAdmin(), loadSettings()]);
  const research = briefs.filter((b) => isResearch(b.weekId));
  return (
    <>
      <h1>Research</h1>
      <p className="muted">
        Research any topic with the same live data, quality checks and AI rules as the Sunday brief.
        Research briefs are separate from the Sunday brief and are not emailed automatically.
      </p>

      <ResearchForm isAdmin={admin} defaultRegion={settings.regionCode} />

      <h3>Past research</h3>
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
