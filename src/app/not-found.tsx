import Link from "next/link";

// Shown for unknown pages and for weeks that have no brief, in the app's own style.
export default function NotFound() {
  return (
    <section className="empty">
      <div className="empty-icon">📭</div>
      <h1>Page not found</h1>
      <p className="dim">There is no brief or page at this address. Briefs are listed by week, for example 2026-W41.</p>
      <p style={{ display: "flex", gap: 8, justifyContent: "center", flexWrap: "wrap", marginTop: 16 }}>
        <Link href="/" className="btn-primary">Open this week&apos;s brief</Link>
        <Link href="/archive" className="btn-ghost">See the archive</Link>
      </p>
    </section>
  );
}
