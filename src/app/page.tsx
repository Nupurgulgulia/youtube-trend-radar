import BriefPage from "@/components/BriefPage";
import ResearchStrip from "@/components/ResearchStrip";
import { isRealWeek, isResearch, listBriefs, loadBrief } from "@/lib/brief-store";

// Map step 12: the latest Sunday brief, with the latest research briefs above it.
export const dynamic = "force-dynamic";

export default async function Home() {
  const briefs = await listBriefs();
  const research = briefs.filter((b) => isResearch(b.weekId)).slice(0, 3);
  // Newest real Sunday week; a test preview only if no real brief exists yet.
  const main = briefs.find((b) => isRealWeek(b.weekId)) ?? briefs.find((b) => !isResearch(b.weekId));
  const row = main ? await loadBrief(main.weekId) : null;

  return (
    <>
      <ResearchStrip items={research} />
      {row ? (
        <BriefPage row={row} />
      ) : (
        <>
          <h1>YouTube Trend Radar</h1>
          <p>No Sunday brief has been published yet. The first one appears after the Sunday run.</p>
        </>
      )}
    </>
  );
}
