import {
  CONFIDENCE_CREATORS_POINT,
  CONFIDENCE_ENGAGEMENT_COVERAGE,
  CONFIDENCE_VIDEOS_POINT,
} from "./config/scoring";
import type { Momentum } from "./momentum";

// Confidence (map step 7). Computed from the evidence only, never from Gemini's wording.
// One point each for: enough videos, enough creators, engagement data for most videos,
// and comparable snapshot history.
//   4 points = high (so high is impossible without history)
//   2-3      = medium
//   0-1      = low
// insufficient_evidence is always low.

export type Confidence = "high" | "medium" | "low";

export type ConfidenceInput = {
  videoCount: number;
  creatorCount: number;
  engagementCoverage: number; // share of videos with an engagement rate
  hasHistory: boolean;
  momentum: Momentum;
};

export function computeConfidence(input: ConfidenceInput): { level: Confidence; reasons: string[] } {
  if (input.momentum === "insufficient_evidence") {
    return { level: "low", reasons: ["Momentum could not be established."] };
  }
  const points = [
    [input.videoCount >= CONFIDENCE_VIDEOS_POINT, `${input.videoCount} videos (point at ${CONFIDENCE_VIDEOS_POINT})`],
    [input.creatorCount >= CONFIDENCE_CREATORS_POINT, `${input.creatorCount} creators (point at ${CONFIDENCE_CREATORS_POINT})`],
    [
      input.engagementCoverage >= CONFIDENCE_ENGAGEMENT_COVERAGE,
      `engagement known for ${Math.round(input.engagementCoverage * 100)}% of videos (point at ${CONFIDENCE_ENGAGEMENT_COVERAGE * 100}%)`,
    ],
    [input.hasHistory, input.hasHistory ? "comparable snapshot history" : "no comparable snapshot history"],
  ] as const;
  const score = points.filter(([ok]) => ok).length;
  const level: Confidence = score === 4 ? "high" : score >= 2 ? "medium" : "low";
  return { level, reasons: points.map(([ok, text]) => `${ok ? "+1" : "+0"} ${text}`) };
}
