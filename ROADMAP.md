# Project Wrapped — Product Roadmap

> A Spotify-Wrapped-style recap for software projects, built on Azure DevOps (and,
> experimentally, GitHub) data. The product goal is an **automated, reliable,
> presentation-ready** recap that tells the project story **accurately** and in a
> way the whole team can understand.
>
> **Guiding principle:** accuracy and traceability first, then storytelling and
> presentation. Never show a flashy number the underlying data can't back up.

Last reviewed: 2026-07-08.

---

## 1. Current state

**Architecture.** Full-stack TypeScript: React 18 + Vite + Tailwind/shadcn front end,
Express back end, PostgreSQL via Drizzle. Data sources: Azure DevOps (primary),
GitHub (experimental), JSON upload, and bundled sample data. The server fetches +
aggregates a source into a single `ProjectWrappedData` object
([shared/schema.ts](shared/schema.ts)), stores it in Postgres under a short id, and
the client renders a nine-slide scroll experience with PNG/PDF export.

**Data flow.**
`home.tsx` form → `POST /api/connect/azure-devops` →
[server/services/azure-devops.ts](server/services/azure-devops.ts) (repos → commits,
PRs, work items → aggregation) → `saveWrapped` (Postgres) →
`GET /api/wrapped/:id` → slides in
[client/src/pages/project-wrapped.tsx](client/src/pages/project-wrapped.tsx).

**Slides:** Intro → Global Stats → Champions → Team → Top 5 → Modules → Timeline →
Highlights/Fun Facts → Outro.

### What already works well
- **Robust ingestion.** Commits and PRs page through `$top`/`$skip`; work items use an
   id-watermark WIQL loop to get past the 20k row cap, then batched detail fetches with
  bounded concurrency. Large arrays are handled stack-safely.
- **Sound core metrics.** Reviews are correctly defined as reviewers who *cast a vote*;
  PR merge-time and per-author commit streaks are computed correctly.
- **Honest-by-omission UI.** Empty stat cards and leaderboards are hidden rather than
  showing zeros, and metrics that can't be computed at scale (comments) are omitted.
- **Polished presentation.** Count-up animations, intersection-observer reveals,
  navigation dots, and image/PDF export are all in place.

### What changed in this review (already implemented)
- **Consistent "done" definition.** New shared helpers (`isDoneState`, `isBugFixed`,
  `completedStoryPoints`) treat *Done / Closed / Resolved / Completed* as completed,
  case-insensitively, everywhere (project, contributor, module, highlights, fun facts).
- **Story points are now completed-only** — matching the `…Done` field names and the
  "story points delivered" label (previously summed points across *all* work items).
- **PRs are now scoped to the selected date range** (by creation date), consistent with
  commits and work items (previously all PRs regardless of range).
- **Traceability.** A `meta` provenance block (source, filters, repos, counts, KPI
  definitions, caveats) is attached to every generated wrap and surfaced in the UI via a
  "How these numbers were calculated" panel under **The Numbers**.
- **Units bug fixed.** Global-stats cards now render their suffix ("h", "days").
- **Honest sprint label.** The timeline no longer asserts a fabricated sprint count; it
  shows "~N two-week sprints (estimated)" or falls back to elapsed months.
- **GitHub honesty.** Stopped inventing story points from closed-issue counts and stopped
  counting *pending* reviewers as completed reviews.

---

## 2. How to read this roadmap

Tasks are grouped by priority:

- **P0 — Critical for correctness.** The recap must be trustworthy before anything else.
- **P1 — Important for usability.** Makes the tool reliable and understandable.
- **P2 — Nice-to-have for presentation.** Storytelling polish once the data is solid.

Each task lists **Goal · Why it matters · Approach · Acceptance criteria.**

---

## 3. P0 — Critical for correctness

### P0.1 — Unify contributor identity across commits, PRs and work items
- **Goal:** One person = one contributor row, regardless of source.
- **Why it matters:** Commits key on the git `author.name`; PRs and work items key on the
  Azure DevOps `displayName`. When those differ, the same human appears as two
  contributors — inflating "N people made this happen", splitting the Champions and Top 5,
  and undermining every per-person number. This is the single biggest remaining accuracy
  risk for a team-facing recap.
- **Approach:**
  - Prefer identity resolution by email: commits expose `author.email`; enrich PR/work-item
    identities with `uniqueName`/email from the Azure DevOps Identity/Graph fields
    (`createdBy.uniqueName`, `assignedTo` `uniqueName`).
  - Build a canonical identity map (email → display name) and key all aggregation on it,
    keeping the best display name for the label.
  - Provide an optional manual alias map (e.g. `identityAliases: { "j.doe": "John Doe" }`)
    for cases where email isn't available.
  - As an interim safety net, at least trim + case-fold names before keying.
- **Acceptance criteria:** With a fixture where one person commits as `jdoe` and opens PRs
  as `John Doe`, the output contains a single contributor with combined commits + PRs.
  The team count equals distinct resolved identities.

### P0.2 — Surface partial-fetch / data-completeness warnings
- **Goal:** Never let a partially-fetched wrap look complete.
- **Why it matters:** Failed repositories, failed work-item batches, and permission gaps
  are currently swallowed (`catch { skip }`). The recap still renders, silently missing
  data, which directly violates "numbers must be accurate and traceable".
- **Approach:** Thread a `warnings: string[]` (and counters like `reposFailed`,
  `workItemBatchesFailed`, `workItemIdsFound` vs `workItemsFetched`) through the fetch
  layer into `meta`. Render a visible banner in the provenance panel when non-empty
  (e.g. "⚠ 2 of 14 repositories could not be read — numbers may be incomplete").
- **Acceptance criteria:** Simulating a failing repo/batch produces a `meta.warnings`
  entry and a visible warning in the UI; a fully successful fetch shows none.

### P0.3 — Make time-boxed metrics filter on the right date
- **Goal:** A recap for a period reflects work *done in that period*.
- **Why it matters:** Work items are filtered by **created** date, so a bug created before
  the window but fixed during it is missed, and an item created in-window but still open
  inflates totals. For a "what happened this period" story, completion date is usually the
  right axis for "done" metrics.
- **Approach:** Add `System.ChangedDate`/`Microsoft.VSTS.Common.ClosedDate` to the WIQL
  field set; count "bugs fixed" / "points delivered" by close/changed date within range,
  while keeping "created/total" metrics on created date. Document each choice in
  `meta.definitions`.
- **Acceptance criteria:** A fixture bug closed inside the window but created before it is
  counted as fixed; `meta.definitions` states the date axis used for each metric.

### P0.4 — Correct, configurable timezone for activity metrics
- **Goal:** "Busiest hour", "night owl / early bird", and "peak productivity" reflect the
  team's local time, not the server's.
- **Why it matters:** `new Date(date).getHours()` uses the server timezone (often UTC in
  the cloud), so a presented "peak: Morning (9:00)" can be hours off.
- **Approach:** Add an optional `timezone` (IANA, e.g. `Europe/Lisbon`) to the connect
  form and config; compute hour/day buckets in that zone (`Intl.DateTimeFormat` with
  `timeZone`, or `date-fns-tz`). Record the zone in `meta`.
- **Acceptance criteria:** The same commit set produces different busiest-hour output for
  two configured timezones; `meta` records the zone used.

### P0.6 — Consistent date-window semantics across sources
- **Goal:** The three data sources agree on exactly which items fall inside the window.
- **Why it matters:** The three filters use different mechanisms and boundaries:
  commits use Azure `searchCriteria.fromDate/toDate`; work items use a WIQL
  `[System.CreatedDate] >= 'from' AND <= 'to'` literal (interpreted at midnight, so items
  created later on the `to` day can be dropped); PRs use a client-side `withinRange` that
  makes the `to` day fully inclusive in **UTC**. The result is up-to-one-day and timezone
  discrepancies at the window edges. Over months this is minor, but it means the three
  headline counts aren't guaranteed to cover an identical interval.
- **Approach:** Centralize the window into explicit UTC start/end instants and apply the
  same inclusive-end rule everywhere: pass `endOfDay(to)` to the commit `toDate`, use full
  datetime literals in WIQL, and keep the PR filter as-is. Add a fixture/boundary test.
- **Acceptance criteria:** An item dated on the last day of the window is counted (or
  excluded) identically whether it's a commit, PR, or work item.

### P0.7 — Decide the PR date basis (creation vs merge) deliberately
- **Goal:** Scope PR metrics on the axis that matches each metric's meaning.
- **Why it matters:** PRs are currently scoped by **creation** date (consistent with
  "activity that began in the period"). But "PRs merged" / merge-rate are really
  "delivered in the period" metrics, better keyed on the **closed/merge** date. Today a PR
  created before the window but merged inside it is excluded, and one created inside but
  merged after is included — so "merged" counts can drift from what the team shipped.
  - **Tradeoff:** single creation-date axis is simple and totals are intuitive, but mixes
    "opened" and "delivered" semantics; a dual axis (opened-in-range by `creationDate`,
    merged-in-range by `closedDate`) is more accurate but means the opened and merged sets
    differ, which can confuse a naive "X of Y merged" reading.
  - **Recommendation:** for the final product, count "PRs opened" by `creationDate` and
    "PRs merged / merge rate / merge time" by `closedDate`, and label each in
    `meta.definitions`. Mirror the work-item created-vs-closed decision (P0.3).
- **Acceptance criteria:** A fixture PR created before but merged inside the window is
  counted as merged-in-period but not opened-in-period; definitions state each axis.

### P0.5 — Validate and guard imported JSON at scale
- **Goal:** Uploaded JSON can't crash or mislead the recap.
- **Why it matters:** `/api/upload-json` validates shape via Zod but not semantics
  (negative counts, leaderboards inconsistent with contributor totals, thousands of
  contributors). The 5 MB limit is the only size guard.
- **Approach:** Add refinements (non-negative numbers, `dateRange.start <= end`,
  leaderboard names existing among contributors) and sane caps with clear error messages.
- **Acceptance criteria:** Malformed/oversized/self-inconsistent uploads return actionable
  400 errors instead of rendering a misleading wrap.

---

## 4. P1 — Important for usability

### P1.1 — Read real sprints/iterations from Azure DevOps
- **Goal:** Replace the estimated sprint count with actual completed iterations.
- **Why it matters:** `sprintsCompleted` is `dateRange ÷ 2 weeks` — an assumption. Teams
  will notice when it disagrees with their board.
- **Approach:** Query `/work/teamsettings/iterations` (needs a team context) or derive
  distinct `System.IterationPath` values with past end dates. Fall back to the estimate
  only when iterations are unavailable, and label which was used in `meta`.
- **Acceptance criteria:** For a project with defined iterations, the count matches the
  number of past iterations; the estimate is used only as a labelled fallback.

### P1.2 — Add repository name to commits so per-repo stats populate
- **Goal:** Populate the already-computed repository leaderboard.
- **Why it matters:** `repositories` stats are computed and shipped to the client but never
  displayed; per-repo contributor/commit data is genuinely useful.
- **Approach:** Build a **Repositories** slide (top repos by commits, top contributor per
  repo, PR counts). Data already exists in `data.repositories`.
- **Acceptance criteria:** Projects with ≥2 active repos show a Repositories slide ordered
  by commits with a top contributor per repo.

### P1.3 — Show the work-item breakdown
- **Goal:** Visualize `workItemBreakdown` (type → count).
- **Why it matters:** Computed and shipped, never rendered. A simple bar/donut answers
  "what kind of work was this?" (bugs vs features vs tests vs requirements).
- **Approach:** Small chart (Recharts is already a dependency) on the Modules or a new
  "Work" slide; pair with the completed vs total ratio.
- **Acceptance criteria:** Breakdown renders with correct per-type counts summing to
  `stats.totalWorkItems`.

### P1.4 — Show busiest days
- **Goal:** Render `top5.busiestDaysByCommits`.
- **Why it matters:** Computed, never displayed. A great "crunch day" story beat.
- **Approach:** Add a "Busiest Days" panel to the Top 5 slide (date → commits), formatted
  as human dates.
- **Acceptance criteria:** Top 5 busiest days appear with correct commit counts and dates.

### P1.5 — Clarify the "Modules" concept
- **Goal:** Stop implying modules are code areas.
- **Why it matters:** Modules are derived from work-item **Area Paths**, and
  `commits`/`pullRequests` per module are always 0. The header "Where the work happened
  across the codebase" is misleading.
- **Approach:** Rename to "Areas" / "Work Areas", update copy, and make
  `commits`/`pullRequests` optional in `moduleSchema` (or drop them) to remove dead fields.
- **Acceptance criteria:** Slide copy references area paths; no always-zero fields remain
  in the module type.

### P1.6 — Regression tests for the aggregation layer
- **Goal:** Lock in metric definitions.
- **Why it matters:** There are no tests; accuracy fixes can silently regress. This is the
  cheapest insurance for the product's core promise.
- **Approach:** Add Vitest with fixtures of raw Azure commits/PRs/work items and assert on
  `fetchAzureDevOpsData`'s aggregation (done-state handling, story-point crediting, PR
  date scoping, identity merging). Add an `npm test` script.
- **Acceptance criteria:** `npm test` runs in CI-like fashion and covers each P0 metric
  definition with at least one fixture.

### P1.7 — Progress feedback during long fetches
- **Goal:** Tell the user what's happening on large projects.
- **Why it matters:** Fetching a big project is slow and currently silent past a spinner;
  users can't tell progress from a hang.
- **Approach:** Stream progress (SSE/websocket) or a polled status; show "Fetched X
  commits, Y PRs, Z work items…". Consider server-side caching keyed on
  org/project/range to avoid refetching.
- **Acceptance criteria:** The connect flow shows incremental progress and a time estimate
  for a large project.

---

## 5. P2 — Nice-to-have for presentation

### P2.1 — Activity heatmap ("When we code")
- **Goal:** Visualize `activityPattern` (24×7).
- **Approach:** GitHub-style hour×weekday heatmap on a new slide; data already exists.
- **Acceptance criteria:** Heatmap reflects the hourly/daily distributions and highlights
  the busiest cell.

### P2.2 — Trends over time ("What changed")
- **Goal:** Answer "how did activity change across the period?"
- **Approach:** Monthly commit / PR / completed-work-item series (Recharts line/area).
- **Acceptance criteria:** A trend chart with per-month values matching the raw data.

### P2.3 — "What to watch next" closing beat
- **Goal:** End on forward-looking insight, not just celebration.
- **Approach:** Derive light, data-backed signals (open bug trend, longest-open PRs,
  areas with low completion) into a closing slide — clearly framed as observations.
- **Acceptance criteria:** Closing slide shows 2–4 data-derived watch-items with sources.

### P2.4 — Presentation / kiosk mode
- **Goal:** Make it easy to show to the whole team.
- **Approach:** Full-screen, keyboard/auto-advance slide mode distinct from scroll; large
  type; optional confetti on the finale (already in the design guidelines).
- **Acceptance criteria:** A presenter can run the full recap full-screen with
  arrow-key/auto advance.

### P2.5 — Real sharing
- **Goal:** Deliver on the "Share (coming soon)" button.
- **Approach:** The saved id + `/wrapped/:id` link is already shareable; wire the outro
  button to copy the link (as the header already does) and remove "coming soon", or add a
  proper share/export-to-deck flow.
- **Acceptance criteria:** The outro share button copies a working link; no "coming soon".

### P2.6 — GitHub parity
- **Goal:** Bring the GitHub source up to the Azure bar.
- **Approach:** Fetch `/pulls/{n}/reviews` for real reviews, comments via the issues/PR
  comment endpoints, and honor date ranges for PRs/issues; reuse the shared metric
  definitions.
- **Acceptance criteria:** GitHub wraps report real reviews and comments, date-scoped, or
  clearly omit them.

---

## 6. Known assumptions currently baked into the code

Documented here (and, where user-facing, in the in-app provenance panel):

- **Completed state** = Done / Closed / Resolved / Completed (case-insensitive). Teams with
  custom states outside this set will under-count "done" work.
- **Story points** are credited only for completed work items.
- **PRs** are scoped by **creation** date; work items by **created** date; commits by
  **commit** date. All PR-derived metrics (including "merged" / merge rate) therefore use
  the creation axis today — see P0.7 for the recommended creation-vs-merge split.
- **Window boundaries** are not byte-identical across sources (UTC-inclusive end for PRs
  vs midnight-literal for WIQL work items) — up to a one-day edge discrepancy (see P0.6).
- **A review** = a reviewer who cast a non-zero vote on a PR (approve / approve w/
  suggestions / waiting / reject). Assigned-but-inactive reviewers don't count.
- **PR "merged"** = Azure status `completed`.
- **Comments** and **lines added/deleted / files changed** are not collected (too slow at
  project scale) and are intentionally omitted.
- **Activity hours** are computed in the server timezone (see P0.4).
- **Sprints completed** is an estimate from the date range (see P1.1).
- **Contributor identity** is not yet unified across sources (see P0.1).

---

## 7. Suggested sequencing

1. **P0.1 identity** and **P0.2 warnings** — the two biggest trust risks.
2. **P0.3 date axis**, **P0.6 window consistency**, **P0.7 PR date basis** and **P0.4
   timezone** — correctness of time-boxed and activity stats.
3. **P1.6 tests** — lock the definitions in before building more on top.
4. **P1.1–P1.5** — real sprints, then surface the already-computed repos / work-item
   breakdown / busiest days, and relabel Modules.
5. **P2** — heatmap, trends, watch-next, presentation mode, sharing, GitHub parity.
