import Link from "next/link";
import { isRealWeek, listBriefs } from "@/lib/brief-store";
import { fmtDate } from "@/lib/format";

// Map step 12: archive of past briefs, so weeks can be compared.
export const dynamic = "force-dynamic";

export default async function Archive() {
  const briefs = await listBriefs();
  const real = briefs.filter((b) => isRealWeek(b.weekId));
  const previews = briefs.filter((b) => !isRealWeek(b.weekId));
  return (
    <>
      <h1>Archive</h1>
      {real.length === 0 && <p className="muted">No Sunday briefs yet.</p>}
      {real.length > 0 && (
        <table>
          <thead>
            <tr><th>Week</th><th>Status</th><th>Themes</th><th>Published</th></tr>
          </thead>
          <tbody>
            {real.map((b) => (
              <tr key={b.weekId}>
                <td><Link href={`/brief/${b.weekId}`}>{b.weekId}</Link></td>
                <td>{b.status === "thin" ? "Thin week" : "Succeeded"}</td>
                <td>{b.themeCount}</td>
                <td>{fmtDate(b.publishedAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {previews.length > 0 && (
        <>
          <h3>Test previews</h3>
          <ul className="small">
            {previews.map((b) => (
              <li key={b.weekId}>
                <Link href={`/brief/${encodeURIComponent(b.weekId)}`}>{b.weekId}</Link>, {b.themeCount} themes, {fmtDate(b.publishedAt)}
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  );
}
