"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { emailBrief, setDecision } from "@/app/actions";
import type { BriefContent, BriefTheme } from "@/lib/brief";
import { NO_NEWS } from "@/lib/brief-text";
import type { Comparison, GroupStat } from "@/lib/findings";
import { decisionLabel, fmtDate, fmtInt, groupLabel, momentumLabel } from "@/lib/format";

// The Sunday brief (map steps 12 and 14), in the dark "studio" design from Claude Design.
// Every number shown here comes from code. Text written by Gemini Flash sits in tinted
// boxes labelled as AI, so facts and interpretation always look different.

type Decision = "film" | "skip" | "investigate";
type Filter = "all" | "pending" | Decision;
type Tab = "signals" | "formats" | "news" | "checks";

export type BriefDashboardProps = {
  brief: BriefContent;
  isPreview: boolean;
  decisions: Record<string, Decision>;
  previous: Record<string, { decision: Decision; weekId: string }>;
};

const DECISION_ICON: Record<Decision, string> = { film: "🎬", investigate: "🔍", skip: "❌" };
const DECISION_BADGE: Record<Decision, string> = { film: "Marked to film", investigate: "Investigating", skip: "Skipped" };

function AiBox({ label, children, tone = "ai" }: { label: string; children: React.ReactNode; tone?: "ai" | "warn" }) {
  return (
    <div className={tone === "warn" ? "box-warn" : "box-ai"}>
      <span className="box-label">{label}</span>
      {children}
    </div>
  );
}

function comparisonText(c: Comparison) {
  return c.status === "ranked"
    ? `Views per day versus same-age videos: ${c.ranking.map((r) => `${groupLabel(r.group)} ${r.medianBandIndex}x`).join(", ")}`
    : c.message;
}

const LENGTH_COLOR: Record<string, string> = { short: "var(--emerald)", mid: "var(--amber)", long: "var(--blue)", deep: "#a78bfa", unknown: "#52525b" };

function LengthBar({ groups }: { groups: GroupStat[] }) {
  const total = groups.reduce((s, g) => s + g.videos, 0) || 1;
  return (
    <>
      <div className="dist-bar">
        {groups.map((g) => (
          <span key={g.group} style={{ width: `${(g.videos / total) * 100}%`, background: LENGTH_COLOR[g.group] ?? "#52525b" }} title={`${g.group}: ${g.videos} videos`} />
        ))}
      </div>
      <div className="dist-legend">
        {groups.map((g) => (
          <span key={g.group}>
            <i style={{ background: LENGTH_COLOR[g.group] ?? "#52525b" }} />
            {groupLabel(g.group)}: {g.videos} {g.videos === 1 ? "video" : "videos"} from {g.creators} {g.creators === 1 ? "creator" : "creators"}
          </span>
        ))}
      </div>
    </>
  );
}

function TopicCard(props: {
  theme: BriefTheme;
  weekId: string;
  firstRun: boolean;
  decision: Decision | undefined;
  previous?: { decision: Decision; weekId: string };
  pending: boolean;
  onDecide: (slug: string, d: Decision | null) => void;
}) {
  const { theme: t, decision } = props;
  const [tab, setTab] = useState<Tab>("signals");
  const m = t.measured;
  const w = t.written;
  const topFormat = t.findings.formats[0];
  const topLength = t.findings.lengths[0];

  return (
    <article className={`topic${decision ? ` topic-${decision}` : ""}`} id={t.slug}>
      <header className="topic-head">
        <div className="topic-title">
          <div className="pills">
            <span className={`pill pill-conf-${t.confidence}`}>{t.confidence} confidence</span>
            <span className={`pill pill-mom-${t.momentum}`}>{momentumLabel[t.momentum] ?? t.momentum}</span>
            <span className="pill pill-muted">{t.isNew ? "New this week" : `Recurring since ${t.recurringFromWeek}`}</span>
            {decision ? (
              <span className={`pill pill-dec-${decision}`}>{DECISION_ICON[decision]} {DECISION_BADGE[decision]}</span>
            ) : (
              <span className="pill pill-muted">Undecided</span>
            )}
          </div>
          <h2>{t.name}</h2>
          {props.previous && (
            <p className="dim small">Last time ({props.previous.weekId}) you chose {decisionLabel[props.previous.decision]}.</p>
          )}
        </div>

        <div className="dock" role="group" aria-label={`Decision for ${t.name}`}>
          {(["film", "investigate", "skip"] as const).map((d) => (
            <button
              key={d}
              type="button"
              className={`dock-btn dock-${d}${decision === d ? " on" : ""}`}
              aria-pressed={decision === d}
              disabled={props.pending}
              onClick={() => props.onDecide(t.slug, d)}
            >
              <span aria-hidden>{DECISION_ICON[d]}</span> {decisionLabel[d]}
            </button>
          ))}
          {decision && (
            <button type="button" className="dock-btn dock-reset" title="Reset to undecided" aria-label="Reset decision" disabled={props.pending} onClick={() => props.onDecide(t.slug, null)}>
              ↺
            </button>
          )}
        </div>
      </header>

      <div className="topic-body">
        <div className="topic-left">
          <div className="spec">
            <div className="spec-label">
              <svg viewBox="0 0 24 24" aria-hidden><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" /></svg>
              Recommended filming angle
            </div>
            {w ? (
              <>
                <AiBox label="Suggestion (AI, Gemini Flash)">
                  <p className="spec-angle">{w.filming_angle}</p>
                </AiBox>
                <AiBox label="Why it matters this week (AI interpretation)">
                  <p>{w.why_this_week}</p>
                  <p>{w.interpretation}</p>
                </AiBox>
              </>
            ) : (
              <p className="notice">{t.writtenNote} Only the measured evidence is shown for this theme.</p>
            )}
            <div className="chips">
              {topLength && <span className="chip">⏱️ <em>Most common length:</em> <strong>{groupLabel(topLength.group)}</strong> ({topLength.videos} of {m.video_count})</span>}
              {topFormat && <span className="chip">📊 <em>Most common format:</em> <strong>{groupLabel(topFormat.group)}</strong> ({topFormat.videos} of {m.video_count})</span>}
            </div>
            {w && (
              <AiBox label="What is uncertain (AI)" tone="warn">
                <p>{w.uncertain}</p>
              </AiBox>
            )}
          </div>
        </div>

        <div className="topic-right">
          <div className="tabs" role="tablist">
            {(
              [
                ["signals", `Measured signals (${t.videos.length})`],
                ["formats", "Formats & lengths"],
                ["news", `Outside news (${t.news.length})`],
                ["checks", "Quality checks"],
              ] as [Tab, string][]
            ).map(([id, label]) => (
              <button key={id} type="button" role="tab" aria-selected={tab === id} className={`tab${tab === id ? " on" : ""}`} onClick={() => setTab(id)}>
                {label}
              </button>
            ))}
          </div>

          {tab === "signals" && (
            <div className="tab-panel">
              <div className="stat-grid">
                <div><strong>{m.creator_count}</strong>creators</div>
                <div><strong>{m.video_count}</strong>videos</div>
                <div><strong>{fmtInt(m.median_views_per_day)}</strong>median views/day</div>
                <div><strong>{m.views_per_day_vs_same_age_videos ?? "n/a"}x</strong>vs same-age videos</div>
                <div><strong>{m.median_engagement_percent === null ? "n/a" : `${m.median_engagement_percent}%`}</strong>engagement ({m.videos_with_engagement}/{m.video_count})</div>
                <div><strong>{fmtDate(m.first_published)}</strong>to {fmtDate(m.last_published)}</div>
              </div>
              <div className="table-wrap">
                <table className="signals">
                  <thead>
                    <tr><th>Creator</th><th>Video</th><th>Published</th><th className="num">Views/day</th></tr>
                  </thead>
                  <tbody>
                    {t.videos.map((v) => (
                      <tr key={v.link}>
                        <td className="creator"><i />{v.channel}</td>
                        <td className="vid"><a href={v.link} target="_blank" rel="noopener noreferrer" title={v.title}>{v.title}</a></td>
                        <td className="dim">{fmtDate(v.published)}</td>
                        <td className="num blue">{fmtInt(v.views_per_day)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="dim small">Top {t.videos.length} of {m.video_count} videos by views per day. Computed from YouTube data.</p>
              {w && (
                <AiBox label="The evidence in words (AI, numbers checked by code)">
                  <p>{w.youtube_evidence}</p>
                </AiBox>
              )}
            </div>
          )}

          {tab === "formats" && (
            <div className="tab-panel">
              <div className="fact-box">
                <span className="box-label">Lengths (computed, with sample sizes)</span>
                <LengthBar groups={t.findings.lengths} />
                <p className="dim small">{comparisonText(t.findings.lengthComparison)}.</p>
              </div>
              <div className="fact-box">
                <span className="box-label">Formats (from title keywords)</span>
                <p className="small">
                  {t.findings.formats.map((g) => `${groupLabel(g.group)} (${g.videos} ${g.videos === 1 ? "video" : "videos"}, ${g.creators} ${g.creators === 1 ? "creator" : "creators"})`).join(", ")}.
                </p>
                <p className="dim small">{comparisonText(t.findings.formatComparison)}.</p>
              </div>
            </div>
          )}

          {tab === "news" && (
            <div className="tab-panel">
              {t.news.length === 0 && <div className="fact-box">{NO_NEWS}</div>}
              {t.news.map((n) => {
                const used = t.chosenNews?.link === n.link;
                return (
                  <div key={n.link} className={`news${used ? " used" : ""}`}>
                    <a href={n.link} target="_blank" rel="noopener noreferrer">{n.title}</a>
                    <div className="news-meta">
                      <span className="blue">{n.source ?? "Unknown source"}</span>
                      <span>•</span>
                      <span>{fmtDate(n.publishedAt)}</span>
                      {used && <span className="pill pill-mom-established">Used in the brief</span>}
                    </div>
                  </div>
                );
              })}
              {w && w.outside_context !== NO_NEWS && (
                <AiBox label="What the headline adds (AI)">
                  <p>{w.outside_context}</p>
                </AiBox>
              )}
              <p className="dim small">Google News headlines are context only. A headline never proves a YouTube trend.</p>
            </div>
          )}

          {tab === "checks" && (
            <div className="tab-panel">
              <div className="audit">
                <div><span>Theme Gate</span><strong className="ok">Passed: {m.video_count} real videos from {m.creator_count} creators, coherent topic</strong></div>
                <div><span>Publish Gate</span>{w ? <strong className="ok">Passed: every number, date and link checked</strong> : <strong className="bad">Failed after one retry: evidence only</strong>}</div>
                <div><span>Momentum</span><strong className="blue">{momentumLabel[t.momentum] ?? t.momentum}. {t.momentumReasons.join(" ")}</strong></div>
                <div><span>Snapshot history</span><strong>{props.firstRun ? "First run: rising and fading need snapshots at least 5 days apart (from the next Sunday)." : "Compared with stored snapshots from earlier weeks."}</strong></div>
                <div><span>Confidence ({t.confidence})</span><strong>{t.confidenceReasons.join("; ")}</strong></div>
                <div><span>Sample size</span><strong>n = {m.video_count} videos</strong></div>
              </div>
            </div>
          )}
        </div>
      </div>
    </article>
  );
}

export default function BriefDashboard({ brief: b, isPreview, decisions: initial, previous }: BriefDashboardProps) {
  const router = useRouter();
  const [decisions, setDecisions] = useState<Record<string, Decision>>(initial);
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [toast, setToast] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [sending, startSending] = useTransition();
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const c = b.coverage;

  const notify = (msg: string) => {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2600);
  };

  const counts = useMemo(() => {
    const vals = b.themes.map((t) => decisions[t.slug]);
    return {
      all: b.themes.length,
      pending: vals.filter((d) => !d).length,
      film: vals.filter((d) => d === "film").length,
      investigate: vals.filter((d) => d === "investigate").length,
      skip: vals.filter((d) => d === "skip").length,
    };
  }, [b.themes, decisions]);

  const visible = b.themes.filter((t) => {
    const d = decisions[t.slug];
    const statusOk = filter === "all" ? true : filter === "pending" ? !d : d === filter;
    const q = query.trim().toLowerCase();
    const searchOk =
      !q ||
      t.name.toLowerCase().includes(q) ||
      (t.written?.filming_angle.toLowerCase().includes(q) ?? false) ||
      t.videos.some((v) => v.channel.toLowerCase().includes(q) || v.title.toLowerCase().includes(q));
    return statusOk && searchOk;
  });

  const onDecide = (slug: string, d: Decision | null) => {
    const before = decisions[slug];
    const name = b.themes.find((t) => t.slug === slug)?.name ?? slug;
    setDecisions((cur) => {
      const next = { ...cur };
      if (d) next[slug] = d;
      else delete next[slug];
      return next;
    });
    startTransition(async () => {
      const res = await setDecision(b.weekId, slug, d);
      if (res.ok) {
        notify(d ? `${DECISION_ICON[d]} Saved: ${name.slice(0, 32)} marked ${decisionLabel[d]}` : `${name.slice(0, 32)} is back to undecided`);
        return;
      }
      setDecisions((cur) => {
        const next = { ...cur };
        if (before) next[slug] = before;
        else delete next[slug];
        return next;
      });
      if (res.needsLogin) router.push(`/login?next=${encodeURIComponent(`/brief/${b.weekId}`)}`);
      else notify(res.error);
    });
  };

  // Modern clipboard first; some browsers and embedded views block it, so fall back to
  // the older select-and-copy method that the original design used.
  const copy = async (text: string, msg: string) => {
    try {
      await navigator.clipboard.writeText(text);
      notify(msg);
      return;
    } catch {
      // fall through
    }
    const el = document.createElement("textarea");
    el.value = text;
    el.setAttribute("readonly", "");
    el.style.position = "fixed";
    el.style.opacity = "0";
    document.body.appendChild(el);
    el.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(el);
    notify(ok ? msg : "Could not copy. Your browser blocked the clipboard.");
  };

  // Manual send: same email as the Sunday one, to the Settings address. Asks first.
  const onEmail = () => {
    if (!confirm(`Email the ${b.weekId} brief now to the address in Settings?`)) return;
    startSending(async () => {
      const res = await emailBrief(b.weekId);
      if (res.ok) notify(`✉️ Brief emailed to ${res.to}`);
      else if (res.needsLogin) router.push(`/login?next=${encodeURIComponent(`/brief/${b.weekId}`)}`);
      else notify(res.error);
    });
  };

  const notionText = () => {
    const film = b.themes.filter((t) => decisions[t.slug] === "film");
    const lines = [`SUNDAY FILMING PLAN FOR ISHAAN (${b.weekId})`, `Brief generated ${fmtDate(b.generatedAt)}. Status: ${b.status}.`, ""];
    if (film.length === 0) lines.push("No topics marked Film yet.");
    film.forEach((t, i) => {
      lines.push(`TOPIC ${i + 1}: ${t.name}`);
      lines.push(`- Momentum: ${momentumLabel[t.momentum] ?? t.momentum}, ${t.confidence} confidence`);
      lines.push(`- Evidence: ${t.measured.video_count} videos from ${t.measured.creator_count} creators, median ${fmtInt(t.measured.median_views_per_day)} views per day`);
      if (t.written) lines.push(`- Filming angle (AI suggestion): ${t.written.filming_angle}`);
      lines.push(`- Top channels: ${[...new Set(t.videos.map((v) => v.channel))].join(", ")}`);
      t.videos.slice(0, 3).forEach((v) => lines.push(`  ${v.title}: ${v.link}`));
      lines.push("");
    });
    return lines.join("\n");
  };

  const written = b.themes.filter((t) => t.written).length;
  const chips: [Filter, string, number][] = [
    ["all", "All topics", counts.all],
    ["pending", "Undecided", counts.pending],
    ["film", "🎬 Film queue", counts.film],
    ["investigate", "🔍 Investigating", counts.investigate],
    ["skip", "❌ Skipped", counts.skip],
  ];
  const failedSources = c.sources?.details.filter((d) => d.status === "failed") ?? [];

  return (
    <>
      {isPreview && <p className="notice">Test preview built from a manual dry run. Not a real Sunday brief.</p>}

      <section className="hero">
        <div className="hero-glow" aria-hidden />
        <div className="hero-main">
          <div className="hero-meta">
            <span className={`tag ${b.status === "thin" ? "tag-amber" : "tag-red"}`}>{b.status === "thin" ? "THIN WEEK" : isPreview ? "TEST PREVIEW" : "SUNDAY RUN"}</span>
            <span>Week <strong>{b.weekId}</strong></span>
            <span className="dot">•</span>
            <span>Generated <strong>{fmtDate(b.generatedAt)}</strong></span>
            {c.firstRun && <><span className="dot">•</span><span>First run</span></>}
          </div>
          <h1>Sunday Content Brief for <span className="blue">Ishaan</span></h1>
          <p className="hero-sub">
            {b.themes.length} topic{b.themes.length === 1 ? "" : "s"} passed the quality checks, found in {fmtInt(c.videosScanned)} videos from {fmtInt(c.creators)} creators.
            Every number is computed from YouTube data; AI text is labelled.
          </p>
          <div className="gate-pill">
            <span className="pulse" aria-hidden />
            <span>Theme Gate: {b.themes.length} passed{c.droppedThemes.length ? `, ${c.droppedThemes.length} dropped` : ""}</span>
            <span className="sep">|</span>
            <span>Publish Gate: {written} of {b.themes.length} written parts passed</span>
          </div>
        </div>

        <div className="hero-side">
          <div className="counters">
            <div><span>Total</span><strong>{counts.all}</strong></div>
            <div><span>Pending</span><strong className="amber">{counts.pending}</strong></div>
            <div><span>Film</span><strong className="emerald">{counts.film}</strong></div>
            <div><span>Skip</span><strong className="crimson">{counts.skip}</strong></div>
          </div>
          <div className="hero-actions">
            <button type="button" className="btn-primary" onClick={() => copy(notionText(), `Copied ${counts.film} Film topic${counts.film === 1 ? "" : "s"} for Notion`)}>
              <svg viewBox="0 0 24 24" aria-hidden><path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-5 14H7v-2h7v2zm3-4H7v-2h10v2zm0-4H7V7h10v2z" /></svg>
              Copy brief for Notion
            </button>
            <button type="button" className="btn-ghost btn-email" onClick={onEmail} disabled={sending}>
              {sending ? "Sending..." : "✉️ Email brief"}
            </button>
          </div>
        </div>
      </section>

      {b.thinWeekNote && <p className="notice">{b.thinWeekNote}</p>}

      <section className="summary-row">
        <AiBox label={b.summaryFromCode ? "Summary (written by code, the AI summary failed checks)" : "Summary (AI, numbers checked by code)"}>
          <p>{b.executiveSummary}</p>
        </AiBox>
        {b.topOpportunities.length > 0 && (
          <div className="card">
            <h3>Strongest opportunities</h3>
            <ul>
              {b.topOpportunities.map((o) => (
                <li key={o.slug}><a href={`#${o.slug}`}>{o.name}</a>: {o.reason}</li>
              ))}
            </ul>
            <p className="dim small">Suggested by AI. You make the final call.</p>
          </div>
        )}
      </section>

      <div className="filter-bar">
        <div className="filter-chips">
          {chips.map(([id, label, n]) => (
            <button key={id} type="button" className={`fchip fchip-${id}${filter === id ? " on" : ""}`} onClick={() => setFilter(id)}>
              <span>{label}</span>
              <span className="fchip-n">{n}</span>
            </button>
          ))}
        </div>
        <div className="filter-search">
          <svg viewBox="0 0 24 24" aria-hidden><path d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
          <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search topics, creators, videos..." aria-label="Search topics" />
        </div>
        <div className="filter-count mono">Showing <strong>{visible.length}</strong> of {b.themes.length}</div>
      </div>

      <div className="feed">
        {visible.length === 0 ? (
          <div className="empty">
            <div className="empty-icon">🔍</div>
            <h3>No topics match this filter or search</h3>
            <button type="button" className="btn-primary" onClick={() => { setFilter("all"); setQuery(""); }}>Reset filters</button>
          </div>
        ) : (
          visible.map((t) => (
            <TopicCard
              key={t.slug}
              theme={t}
              weekId={b.weekId}
              firstRun={c.firstRun}
              decision={decisions[t.slug]}
              previous={previous[t.slug]}
              pending={pending}
              onDecide={onDecide}
            />
          ))
        )}
      </div>

      <section className="card coverage">
        <h3>Data coverage</h3>
        <div className="stat-grid">
          <div><strong>{fmtInt(c.videosScanned)}</strong>videos scanned</div>
          <div><strong>{fmtInt(c.creators)}</strong>creators</div>
          <div><strong>{c.quotaUsed ?? "n/a"}</strong>quota units (estimate {c.quotaEstimated ?? "n/a"})</div>
          <div><strong>{c.searchCalls ?? "n/a"}</strong>searches</div>
        </div>
        <p className="small"><strong>Keywords searched:</strong> {c.keywordsSearched.join(", ") || "none"}</p>
        {c.keywordsSkipped.length > 0 && (
          <p className="small"><strong>Keywords skipped:</strong> {c.keywordsSkipped.map((k) => `${k.keyword} (${k.reason})`).join("; ")}</p>
        )}
        <p className="small"><strong>Sources:</strong> YouTube {c.sources?.youtube.status ?? "unknown"}, news {c.sources?.news.status ?? "unknown"}</p>
        {failedSources.length > 0 && <ul className="small">{failedSources.map((d) => <li key={d.source}>{d.source}: {d.reason}</li>)}</ul>}
        {c.droppedThemes.length > 0 && (
          <p className="small"><strong>Dropped by the quality checks:</strong> {c.droppedThemes.map((d) => d.name).join(", ")}</p>
        )}
        <h3>Limitations</h3>
        <ul className="small">{c.limitations.map((l) => <li key={l}>{l}</li>)}</ul>
      </section>

      <div className={`toast${toast ? " show" : ""}`} role="status" aria-live="polite">{toast}</div>
    </>
  );
}
