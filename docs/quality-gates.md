# Quality gates

Gemini Flash is used for two things only: proposing groups of videos (step 8) and writing the brief (step 10). Code checks both answers. When a check fails, Gemini gets **one** retry with the exact errors. The rules are never loosened to let something pass. A run makes at most **4** Gemini calls.

## Theme Gate (step 9, `src/lib/theme-gate.ts`)

Gemini sees about 150 videos (ID, title, channel, tags, format, length, age), with **no view counts or other metrics**.

- **Fair share:** trending and each keyword search take turns filling the 150 slots, best for their age first, so viral gadget videos can't crowd out "AI tools".

Each proposed theme must pass all of these checks:

| Check | Rule |
|---|---|
| Real IDs | Every video ID exists in this run's data. |
| No overlap | A video already used by an earlier theme fails the later one. |
| Support | At least 3 videos from at least 2 different channels. |
| Coherence | At least 60% of the videos share a significant keyword with the theme name or with another video in the theme. Common filler words don't count (`src/lib/config/keywords.ts`). |
| Traceable metrics | Every number for the theme is recomputed by code from stored snapshots. Gemini's answer contains no numbers. |
| Justified momentum | Momentum and confidence come from `docs/scoring.md`, never from Gemini. |

**Past-theme matching:** a theme is "Recurring since <week>" if an earlier real week had a theme with the same slug, or at least half of the name keywords in common. Manual test runs are never counted as earlier weeks.

## Publish Gate (step 11, `src/lib/publish-gate.ts`)

Gemini receives, per theme, the measured numbers (already rounded), the format findings, up to 5 videos and up to 3 matched headlines. Every written field is then checked:

| Check | Rule |
|---|---|
| Numbers | Every number written in digits must match an evidence number within 2%, or within 0.5 for small values. Forms like `139k`, `2.95x`, `1.7%`, `1,22,715` and `1.2 lakh` are understood. |
| Dates | Dates are checked as whole dates (`2026-10-06`, `6 October`, `October 6`). The parts of a date never count as evidence numbers. |
| Codes | Mixed tokens such as `V80`, `144Hz` or `S26` must appear in the evidence text. |
| Links | Every URL must be a video or news link from the evidence. |
| Quotes | Quoted text of 12 or more characters must be a real title or headline. |
| Labels | Momentum and confidence must be copied unchanged. |
| Direction | Words like "rising", "surging" or "taking off" are refused unless momentum is rising. "Fading" or "declining" are refused unless momentum is fading. |
| Outside context | Either a valid news index, or no index and exactly "No related news found." |
| Summary | Same number, date and link checks across all themes. Top opportunities must name real themes. |

**After the one retry:**

- A theme that still fails is published with its **measured evidence only** and the note "Written summary failed checks."
- If the executive summary still fails, a plain sentence built by code replaces it.
- Em dashes are replaced with commas in code, not by retrying.

## Outcome

| Themes that passed the Theme Gate | Run status |
|---|---|
| 3 to 5 | `succeeded` |
| 1 or 2 | `thin`. Published with a "Thin week" note and never padded. |
| 0, or YouTube collection failed | `failed`. No brief. A short failure notice is sent instead. |

## First live run of steps 7 to 11 (2026-10-11, dry run)

- **Outcome:** succeeded, with 4 themes. 3 Gemini calls: 1 cluster call and 2 write calls. Took about 82 seconds in total.
- **Blocked:** one filming idea mentioned "30,000", probably a price, which is not in the evidence. It was still there after the retry, so that theme was published with evidence only.
- **Checked by hand:** "7200mAh" in another filming idea is in a real video title, so it was correctly allowed. All dates matched real publish dates.

## Known limitations

1. **Numbers written as words** ("four videos") are not checked.
2. **Coincidental matches:** an invented number that happens to equal an evidence number passes.
3. **Interpretation is free text.** It is labelled as interpretation on the page, and only numbers, dates, codes, links, quotes and direction words are checked in it.
4. **Loose news matching:** news is matched on any shared keyword, so loosely related headlines (for example any "laptop" story) can be offered. Gemini usually picks the relevant one, and the page always shows our stored headline and link, never text Gemini typed.
5. **Slow writing:** the write call took 45 to 55 seconds in testing, which matters for the Vercel function time limit (checkpoint 9).
