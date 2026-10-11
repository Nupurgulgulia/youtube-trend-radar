import { isAdmin } from "@/lib/auth";
import { isRealWeek, loadDecisions, loadPreviousDecisions, type BriefRow } from "@/lib/brief-store";
import BriefView from "./BriefView";

// Loads the decisions for a brief and renders it. Shared by "/" and "/brief/[weekId]".
// Decisions on a test preview are saved under the preview's own label, and
// loadPreviousDecisions only looks at real weeks, so they never leak into a real brief.
export default async function BriefPage({ row }: { row: BriefRow }) {
  const slugs = row.content.themes.map((t) => t.slug);
  const [decisions, previous, admin] = await Promise.all([
    loadDecisions(row.weekId),
    loadPreviousDecisions(row.weekId, slugs),
    isAdmin(),
  ]);
  return <BriefView brief={row.content} isPreview={!isRealWeek(row.weekId)} decisions={decisions} previous={previous} admin={admin} />;
}
