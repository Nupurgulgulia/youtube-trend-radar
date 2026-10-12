import Link from "next/link";
import { fmtDate } from "@/lib/format";

// "Latest research" row at the top of the home page, with a button to start a new one.
export default function ResearchStrip({
  items,
}: {
  items: { weekId: string; researchTopic: string | null; themeCount: number; publishedAt: string }[];
}) {
  return (
    <section className="research-strip" aria-label="Latest research">
      <div className="research-strip-head">
        <h3>Latest research</h3>
        <Link href="/research#new" className="btn-primary btn-small">+ New research</Link>
      </div>
      {items.length === 0 ? (
        <p className="dim small">No research yet. Type any topic on the Research page and the brief will appear here.</p>
      ) : (
        <div className="research-strip-items">
          {items.map((b) => (
            <Link key={b.weekId} href={`/brief/${encodeURIComponent(b.weekId)}`} className="research-chip">
              <strong>{b.researchTopic ?? b.weekId}</strong>
              <span className="dim small">{b.themeCount} themes · {fmtDate(b.publishedAt)}</span>
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}
