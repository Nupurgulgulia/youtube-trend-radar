import { notFound } from "next/navigation";
import BriefPage from "@/components/BriefPage";
import { loadBrief } from "@/lib/brief-store";

// Map step 12: one archived brief.
export const dynamic = "force-dynamic";

export default async function BriefByWeek({ params }: { params: Promise<{ weekId: string }> }) {
  const { weekId } = await params;
  const row = await loadBrief(decodeURIComponent(weekId));
  if (!row) notFound();
  return <BriefPage row={row} />;
}
