import { decide } from "@/app/actions";
import type { BriefContent, BriefTheme } from "@/lib/brief";
import type { Decision } from "@/lib/brief-store";
import type { Comparison, GroupStat } from "@/lib/findings";
import { decisionLabel, fmtDate, fmtInt, groupLabel, momentumLabel } from "@/lib/format";
import { NO_NEWS } from "@/lib/write";

// The Sunday brief (map steps 12 and 14). Neutral boxes hold numbers computed by code;
// tinted boxes hold text written by Gemini Flash, which passed the Publish Gate.

type Props = {
  brief: BriefContent;
  isPreview: boolean;
  decisions: Map<string, { decision: Decision; note: string | null }>;
  previous: Map<string, { decision: Decision; weekId: string }>;
  admin: boolean;
};

function AiBox({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="ai">
      <span className="ai-label">{label}</span>
      {children}
    </div>
  );
}

function comparisonText(c: Comparison) {
  return c.status === "ranked"
    ? `Compared with videos of the same age: ${c.ranking.map((r) => `${groupLabel(r.group)} ${r.medianBandIndex}x`).join(", ")}`
    : c.message;
}

function Groups({ title, groups, comparison }: { title: string; groups: GroupStat[]; comparison: Comparison }) {
  return (
    <div className="small">
      <strong>{title}:</strong>{" "}
      {groups.map((g) => `${groupLabel(g.group)} (${g.videos} videos, ${g.creators} creators)`).join(", ")}.{" "}
      <span className="muted">{comparisonText(comparison)}.</span>
    </div>
  );
}

function DecisionForm({ weekId, theme, current, previous, admin }: {
  weekId: string;
  theme: BriefTheme;
  current?: { decision: Decision; note: string | null };
  previous?: { decision: Decision; weekId: string };
  admin: boolean;
}) {
  return (
    <div className="decision">
      <h3>Your decision</h3>
      {previous && (
        <p className="muted">
          Last time ({previous.weekId}) you chose: {decisionLabel[previous.decision]}
        </p>
      )}
      <form action={decide}>
        <input type="hidden" name="weekId" value={weekId} />
        <input type="hidden" name="slug" value={theme.slug} />
        {(["film", "skip", "investigate"] as const).map((d) => (
          <button key={d} type="submit" name="decision" value={d} className={current?.decision === d ? "selected" : ""}>
            {decisionLabel[d]}
          </button>
        ))}
        <input type="text" name="note" placeholder="Optional note" defaultValue={current?.note ?? ""} aria-label="Optional note" />
      </form>
      {current && <p className="muted small">Saved: {decisionLabel[current.decision]}</p>}
      {!admin && <p className="muted small">You will be asked for the admin password the first time.</p>}
    </div>
  );
}

function ThemeCard({ theme, weekId, props }: { theme: BriefTheme; weekId: string; props: Props }) {
  const m = theme.measured;
  const w = theme.written;
  return (
    <section className="card" id={theme.slug}>
      <h2>{theme.name}</h2>
      <div className="badges">
        <span className={`badge ${theme.momentum}`}>{momentumLabel[theme.momentum] ?? theme.momentum}</span>
        <span className={`badge ${theme.confidence}`}>{theme.confidence} confidence</span>
        <span className="badge neutral">{theme.isNew ? "New this week" : `Recurring since ${theme.recurringFromWeek}`}</span>
      </div>

      {theme.writtenNote && <p className="notice">{theme.writtenNote} Only the measured evidence is shown for this theme.</p>}

      {w && (
        <>
          <h3>Why it matters this week</h3>
          <AiBox label="Interpretation (AI, Gemini Flash)">
            <p>{w.why_this_week}</p>
            <p>{w.interpretation}</p>
          </AiBox>
        </>
      )}

      <h3>Evidence (measured)</h3>
      <div className="fact">
        <span className="fact-label">Computed from YouTube data</span>
        <div className="stats">
          <div><strong>{m.creator_count}</strong>creators</div>
          <div><strong>{m.video_count}</strong>videos</div>
          <div><strong>{fmtInt(m.median_views_per_day)}</strong>median views per day</div>
          <div><strong>{m.views_per_day_vs_same_age_videos ?? "n/a"}x</strong>vs videos of the same age</div>
          <div>
            <strong>{m.median_engagement_percent === null ? "n/a" : `${m.median_engagement_percent}%`}</strong>
            engagement ({m.videos_with_engagement} of {m.video_count} videos)
          </div>
          <div><strong>{fmtDate(m.first_published)}</strong>to {fmtDate(m.last_published)}</div>
        </div>
        <p className="small muted">Momentum: {theme.momentumReasons.join(" ")}</p>
        <ul className="videos">
          {theme.videos.map((v) => (
            <li key={v.link}>
              <a href={v.link} target="_blank" rel="noopener noreferrer">{v.title}</a>
              <div className="muted small">
                {v.channel} · {fmtDate(v.published)} · {fmtInt(v.views_per_day)} views per day
              </div>
            </li>
          ))}
        </ul>
      </div>
      {w && (
        <AiBox label="The evidence in words (AI, numbers checked by code)">
          <p>{w.youtube_evidence}</p>
        </AiBox>
      )}

      <h3>Outside context</h3>
      {theme.chosenNews ? (
        <div className="fact">
          <span className="fact-label">Google News headline (context only, not proof of a YouTube trend)</span>
          <a href={theme.chosenNews.link} target="_blank" rel="noopener noreferrer">{theme.chosenNews.title}</a>
          <div className="muted small">
            {theme.chosenNews.source ?? "Unknown source"} · {fmtDate(theme.chosenNews.publishedAt)}
          </div>
          {w && w.outside_context !== NO_NEWS && <p className="small" style={{ marginTop: 6 }}>{w.outside_context}</p>}
        </div>
      ) : (
        <div className="fact">{NO_NEWS}</div>
      )}

      <h3>Formats and lengths</h3>
      <div className="fact">
        <span className="fact-label">Computed, with sample sizes</span>
        <Groups title="Formats" groups={theme.findings.formats} comparison={theme.findings.formatComparison} />
        <Groups title="Lengths" groups={theme.findings.lengths} comparison={theme.findings.lengthComparison} />
      </div>

      {w && (
        <>
          <h3>Filming angle</h3>
          <AiBox label="Suggestion (AI)">
            <p>{w.filming_angle}</p>
          </AiBox>
        </>
      )}

      <h3>What is uncertain</h3>
      {w && (
        <AiBox label="Interpretation (AI)">
          <p>{w.uncertain}</p>
        </AiBox>
      )}
      <div className="fact small">
        <span className="fact-label">Why confidence is {theme.confidence}</span>
        {theme.confidenceReasons.join("; ")}.
      </div>

      <DecisionForm
        weekId={weekId}
        theme={theme}
        current={props.decisions.get(theme.slug)}
        previous={props.previous.get(theme.slug)}
        admin={props.admin}
      />
    </section>
  );
}

export default function BriefView(props: Props) {
  const b = props.brief;
  const c = b.coverage;
  const failedSources = c.sources?.details.filter((d) => d.status === "failed") ?? [];
  return (
    <>
      {props.isPreview && (
        <p className="notice">Test preview built from a manual dry run. Not a real Sunday brief.</p>
      )}
      <h1>Sunday brief, {b.weekId}</h1>
      <div className="badges">
        <span className={`badge ${b.status}`}>{b.status === "thin" ? "Thin week" : "Succeeded"}</span>
        <span className="badge neutral">Generated {fmtDate(b.generatedAt)}</span>
        {c.firstRun && <span className="badge neutral">First run</span>}
      </div>
      {b.thinWeekNote && <p className="notice">{b.thinWeekNote}</p>}

      <AiBox label={b.summaryFromCode ? "Summary (written by code, the AI summary failed checks)" : "Summary (AI, numbers checked by code)"}>
        <p>{b.executiveSummary}</p>
      </AiBox>

      {b.topOpportunities.length > 0 && (
        <div className="card">
          <h2>Strongest opportunities</h2>
          <ul>
            {b.topOpportunities.map((o) => (
              <li key={o.slug}>
                <a href={`#${o.slug}`}>{o.name}</a>: {o.reason}
              </li>
            ))}
          </ul>
          <p className="muted small">Suggested by AI. You make the final call below.</p>
        </div>
      )}

      {b.themes.map((t) => (
        <ThemeCard key={t.slug} theme={t} weekId={b.weekId} props={props} />
      ))}

      <section className="card">
        <h2>Data coverage</h2>
        <div className="stats">
          <div><strong>{fmtInt(c.videosScanned)}</strong>videos scanned</div>
          <div><strong>{fmtInt(c.creators)}</strong>creators</div>
          <div><strong>{c.quotaUsed ?? "n/a"}</strong>quota units used (estimate {c.quotaEstimated ?? "n/a"})</div>
          <div><strong>{c.searchCalls ?? "n/a"}</strong>searches</div>
        </div>
        <p className="small"><strong>Keywords searched:</strong> {c.keywordsSearched.join(", ") || "none"}</p>
        {c.keywordsSkipped.length > 0 && (
          <p className="small">
            <strong>Keywords skipped:</strong> {c.keywordsSkipped.map((k) => `${k.keyword} (${k.reason})`).join("; ")}
          </p>
        )}
        <p className="small">
          <strong>Sources:</strong> YouTube {c.sources?.youtube.status ?? "unknown"}, news {c.sources?.news.status ?? "unknown"}
        </p>
        {failedSources.length > 0 && (
          <ul className="small">
            {failedSources.map((d) => <li key={d.source}>{d.source}: {d.reason}</li>)}
          </ul>
        )}
        {c.droppedThemes.length > 0 && (
          <p className="small">
            <strong>Themes dropped by the quality checks:</strong> {c.droppedThemes.map((d) => d.name).join(", ")}
          </p>
        )}
        <h3>Limitations</h3>
        <ul className="small">{c.limitations.map((l) => <li key={l}>{l}</li>)}</ul>
      </section>
    </>
  );
}
