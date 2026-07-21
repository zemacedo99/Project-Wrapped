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

**Configuration (P1.9).** A versioned `WrappedConfig` tailors the recap: Story Points are
off by default, repositories are selected at import time (accurately changing the numbers),
and contributors can be filtered for the people sections. Settings live in a side panel with
JSON export/import; see [wrapped-config.ts](client/src/lib/wrapped-config.ts).

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
- **Honest sprint label.** The timeline never estimates a sprint count from the date range
  (cadence varies, 2–3 weeks). It shows the real number of Azure DevOps iterations overlapping
  the range when available, otherwise it shows elapsed months only and hides the sprint count.
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

### P0.1 — Unify contributor identity across commits, PRs and work items ✅ DONE
- **Goal:** One person = one contributor row, regardless of source.
- **What was implemented:**
  - Commit rows now capture `author.email`; PR/reviewer/work-item rows capture Azure
    `uniqueName`; each row records its `source` (git / azure / mixed).
  - `canonicalizeContributors()` auto-merges rows by (1) shared email/uniqueName then
    (2) exact normalized display name, preferring the Azure display name as the label and
    summing metrics into aliases (per-alias commit counts kept). Runs server-side so
    Champions, Top 5 and Team all use the one canonical set — fixing the Commit-Champion vs
    Top-Contributors mismatch.
  - Git identities with no Azure match are flagged `isUnmappedGit` and shown separately.
  - **User-confirmed manual associations** (`config.identityAssociations`) merge remaining
    git aliases into a person in Settings → Contributors; applied client-side in
    `applyConfig` and exported/imported with the config. No silent fuzzy matching.
  - Tested: email match, normalized-name match, unmapped git, summed commits, no duplicate
    rows, and Champion == Top after merge (both backend + client layers).
- **Remaining:** cross-project identity, and richer suggestion of *likely* matches (currently
  only auto-merges exact signals; everything else is manual).
- **Original approach notes:**
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

### P0.2 — Surface partial-fetch / data-completeness warnings ✅ DONE
- **Goal:** Never let a partially-fetched wrap look complete.
- **Why it mattered:** Failed repositories, failed work-item batches, and permission gaps
  were swallowed (`catch { skip }`). The recap still rendered, silently missing data.
- **What was implemented:**
  - An `ImportCompleteness` tracker threaded through `fetchRepositories`, `fetchCommits`,
    `fetchPullRequests` and `fetchWorkItems`, plus `summarizeCompleteness()` which derives
    an overall status (`complete` / `partial` / `failed`) and plain-language warnings that
    name *what* is missing and *which numbers* it affects.
  - Category fetches now run via `Promise.allSettled`, so a total failure of one category
    (e.g. PRs or work items) yields a **partial** recap with a warning instead of a 500.
  - The summary is saved on `meta.completeness` (counts only — no raw errors or tokens).
  - The provenance panel shows a **visible banner** (no expand needed) for partial/failed
    imports, a status pill in the header, and a positive confirmation when complete.
  - GitHub reports a minimal completeness (flags when a paging cap was hit).
  - Old wraps without `meta.completeness` remain valid (schema optional; UI treats them as
    `unknown` and shows nothing).
- **Acceptance criteria (met):** unit tests prove a failing repo/PR-category/work-item-batch
  and a no-repositories result each produce clear warnings and a non-`complete` status,
  while a clean import produces `complete` with no warnings.
- **Deliberately deferred (see P1.8):** field-level completeness (e.g. "% of work items
  without story points / area path"). This pass covers *fetch* failures — the actual trust
  blocker — not per-field sparsity.

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
- **Goal:** Replace the estimated sprint count with actual completed iterations. ✅ DONE
- **What was implemented:** `fetchIterations()` reads the project-level classification-nodes
  iterations tree (`/wit/classificationnodes/iterations?$depth=10`) — no team context needed —
  and `countIterationsInRange()` counts iterations overlapping the selected date range.
  `sprintsCompleted` uses this real count when iterations exist; when they cannot be read it is
  set to 0 and the Timeline hides the sprint count entirely (no date-range estimate — cadence
  varies 2–3 weeks). The provenance note states which was used. Tested (`countIterationsInRange`).
- **Remaining:** show real sprint *names* on the Timeline (currently a count only).

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

### P1.5 — Clarify the "Modules" concept ✅ DONE (partial)
- **Goal:** Stop implying modules are code areas.
- **What was implemented:** the slide is renamed **"Work Areas"** with the subtitle
  "Grouped by work item Area Path — not code modules or repositories", and a provenance
  definition explains that grouping is by the leaf of `System.AreaPath` and that commits/PRs
  can't be attributed to an area. The area-grouping logic is covered by `aggregateModuleStats`
  tests.
- **Remaining:** the always-zero `commits`/`pullRequests` fields still exist on `moduleSchema`
  (kept for backward compatibility); drop them in a future cleanup.

### P1.6 — Regression tests for the aggregation layer ✅ DONE (extend as new logic lands)
- **Goal:** Lock in metric definitions.
- **What was implemented:** a zero-dependency harness using Node's built-in test runner via
  `tsx` (`npm test` → `node --import tsx --test server/services/azure-devops.test.ts`), with
  fixtures covering done-state handling, story-point crediting, bug counting, PR date
  scoping, contributor/module aggregation, PR merge-time, top-5, the completeness model, and
  schema backward-compatibility.
- **Remaining:** add fixtures as P0.1 (identity) and P0.3/P0.7 (date axis) land; consider a
  second test file + CI wiring (the `test` script currently names one file explicitly).

### P1.8 — Field-level completeness (data sparsity)
- **Goal:** Warn when imported items are systematically missing key fields.
- **Why it matters:** P0.2 covers *fetch* failures; it does not flag when, say, 90% of work
  items have no Story Points or no Area Path — which would quietly make story-point and
  work-area numbers meaningless even though the import "succeeded".
- **Approach:** During work-item aggregation, count items missing `StoryPoints`, `AreaPath`,
  `State` or `AssignedTo`; if a field is absent on a high proportion of items, add an
  informational `meta.completeness` warning (kept out of the alarming red/amber banner
  unless severe).
- **Acceptance criteria:** A fixture where most work items lack story points produces an
  informational note; a fully-populated set produces none.

### P1.7 — Progress feedback during long fetches
- **Goal:** Tell the user what's happening on large projects.
- **Why it matters:** Fetching a big project is slow and currently silent past a spinner;
  users can't tell progress from a hang.
- **Approach:** Stream progress (SSE/websocket) or a polled status; show "Fetched X
  commits, Y PRs, Z work items…". Consider server-side caching keyed on
  org/project/range to avoid refetching.
- **Acceptance criteria:** The connect flow shows incremental progress and a time estimate
  for a large project.

### P1.9 — Configuration & Settings (Story Points off by default, repo/contributor filtering, export/import) ✅ DONE
- **Goal:** Let the recap be tailored before it's shown to the team.
- **What was implemented:**
  - A versioned, JSON-serializable `WrappedConfig` (`configVersion: 1`) in
    [shared/schema.ts](shared/schema.ts): `showStoryPoints`, `hiddenMetrics`, `hiddenSlides`,
    `contributorSelection {mode, names}`, `repositories`. No secrets/tokens are ever stored.
  - **Story Points hidden by default** — gated across The Numbers, Contributors, Modules,
    Highlights and the provenance definitions; the existing (tested) story-point *logic* is
    untouched and re-enabled by the "Show Story Points" switch.
  - **Repository filtering is import-time** (`selectRepositories` in the Azure fetch): only
    the selected repos are fetched, so commit/PR/repository numbers are genuinely accurate.
    The Azure import dialog gained an all/none/search repository picker.
  - **Contributor filtering** (view-time): a Settings picker with search, sort
    (commits/PRs/reviews/bugs/name, + story points when enabled), activity filters, and
    include/exclude modes. Recomputes the Team, Hall of Fame and Top Contributors sections
    from the stored `contributors[]` and rebuilds the leaderboards.
  - **Settings panel** ([wrapped-settings.tsx](client/src/components/wrapped-settings.tsx)):
    a side sheet with display toggles, section visibility, the contributor picker, repository
    info, and config **download/upload** (validated + reconciled against the recap, unknown
    repos/contributors dropped with a warning, never crashes on bad JSON/old versions).
  - Config persists per-wrap in `localStorage` and is applied at view time
    ([wrapped-config.ts](client/src/lib/wrapped-config.ts)).
  - Provenance panel now lists **active filters** and states plainly that repository scope is
    reflected in the numbers while contributor filtering affects people sections only (project
    totals stay whole-project). P0.2 completeness warnings are untouched.
- **Limitations / follow-ups (see P1.10):**
  - Repository filtering is **import-time only** — you cannot re-scope an existing wrap by
    repo without regenerating (raw per-repo data isn't stored). Work items are project-scoped
    in Azure DevOps and are never affected by repo selection (documented in-panel).
  - Contributor filtering intentionally does **not** change aggregate project totals (commits,
    PRs, bugs, points on The Numbers) — only the people-oriented sections — to avoid implying
    a re-aggregated project total that the stored data can't support accurately.
  - Config lives in `localStorage` + exportable JSON; it is not persisted server-side with the
    wrap.

### P1.10 — Post-hoc, fully-accurate re-aggregation from selected repos/contributors
- **Goal:** Let repository (and total-affecting contributor) filtering re-scope an *existing*
  wrap without regenerating.
- **Why it matters:** Today repo scope is fixed at import; changing it needs a new import.
- **Approach:** Persist a normalized, compact per-commit / per-PR dataset (author, repo, date,
  vote) alongside the aggregates, and recompute stats client- or server-side when filters
  change. Note this still cannot repo-scope work items (project-scoped in Azure DevOps).
- **Acceptance criteria:** Changing the repository selection on a saved wrap updates
  commit/PR/review/contributor numbers accurately, with work-item metrics clearly marked as
  project-wide.

### P1.11 — Bug "resolved by developer" vs "validated by tester" (needs work item history)
- **Goal:** Separate metrics for who *resolved* a bug (moved it to Resolved) and who
  *validated* it (moved it to Done), plus a resolver-based "Bug Slayer" and a validator stat.
- **Why it matters:** Current `bugsFixed` uses the bug's *current state* and credits the
  *current assignee* — which does not prove who changed the state. Crediting the assignee as
  the resolver would be an assumption (explicitly disallowed), so this is deferred until the
  data supports it. The limitation is stated in the provenance panel today.
- **Approach:** Use the Work Item **Updates/Revisions API** (`/wit/workItems/{id}/updates`),
  **only for Bugs**, to find the person who set `System.State` to Resolved and to Done.
  Make it an **opt-in** step (it's one request per bug), cache the result with the wrap, and
  show a clear "history not fetched" state when disabled. Schema already carries optional
  `bugsResolved`/`bugsValidated` fields for this.
- **Acceptance criteria:** With history enabled, each bug's resolver and validator are read
  from its state-change history (never assumed); resolver/validator leaderboards use those.

### P1.12 — Staged import progress + skip disabled work
- **Goal:** Faster, clearer imports (see reported slow 1-repo import).
- **Why it matters:** Even with one repo selected, work items are project-scoped so the WIQL
  + detail fetch dominates; the UI only shows a spinner.
- **Approach:** Stream per-stage progress (repos → commits → PRs → work items → iterations)
  via SSE/polling; state plainly that work items are project-scoped; skip fetches whose
  output is entirely hidden by config (e.g. don't fetch work items if every work-item-derived
  section is disabled); only fetch bug history (P1.11) when those metrics are enabled.
- **Acceptance criteria:** The connect flow shows stage-by-stage progress; disabling all
  work-item sections measurably reduces import time; accuracy is unchanged.

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
- **Sprints completed** is the real count of Azure DevOps iterations overlapping the range,
  or hidden when iterations can't be read — never estimated from the date range (see P1.1).
- **Contributor identity** is not yet unified across sources (see P0.1).

---

## 7. Suggested sequencing

1. **P0.2 warnings** ✅ done and **P0.1 identity** (next) — the two biggest trust risks.
2. **P0.3 date axis**, **P0.6 window consistency**, **P0.7 PR date basis** and **P0.4
   timezone** — correctness of time-boxed and activity stats.
3. **P1.6 tests** ✅ harness in place — extend as the above land.
4. **P1.1–P1.5** — real sprints, then surface the already-computed repos / work-item
   breakdown / busiest days, and relabel Modules.
5. **P2** — heatmap, trends, watch-next, presentation mode, sharing, GitHub parity.
