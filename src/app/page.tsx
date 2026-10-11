import BriefPage from "@/components/BriefPage";
import { loadLatestBrief } from "@/lib/brief-store";

// Map step 12: the latest Sunday brief.
export const dynamic = "force-dynamic";

export default async function Home() {
  const row = await loadLatestBrief();
  if (!row) {
    return (
      <>
        <h1>YouTube Trend Radar</h1>
        <p>No brief has been published yet. The first one appears after the Sunday run.</p>
      </>
    );
  }
  return <BriefPage row={row} />;
}
