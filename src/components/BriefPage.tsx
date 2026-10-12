import { isRealWeek, loadDecisions, loadPreviousDecisions, type BriefRow } from "@/lib/brief-store";
import BriefDashboard from "./BriefDashboard";

// Loads the decisions for a brief and renders it. Shared by "/" and "/brief/[weekId]".
// Decisions on a test preview are saved under the preview's own label, and
// loadPreviousDecisions only looks at real weeks, so they never leak into a real brief.
export default async function BriefPage({ row }: { row: BriefRow }) {
  const slugs = row.content.themes.map((t) => t.slug);
  const [decisions, previous] = await Promise.all([loadDecisions(row.weekId), loadPreviousDecisions(row.weekId, slugs)]);
  return (
    <BriefDashboard
      brief={row.content}
      isPreview={!isRealWeek(row.weekId)}
      decisions={Object.fromEntries([...decisions].map(([slug, d]) => [slug, d.decision]))}
      previous={Object.fromEntries(previous)}
    />
  );
}
