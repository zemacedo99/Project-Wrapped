import https from "https";
import type { ProjectWrappedData, Contributor, ContributorAlias, Module, Milestone, Top5, RepositoryStats, ActivityPattern } from "@shared/schema";

interface AzureDevOpsConfig {
  organization: string;
  project: string;
  personalAccessToken: string;
  baseUrl?: string; // Optional: for on-premises Azure DevOps Server (defaults to cloud)
  repositoryId?: string;
  dateFrom?: string;
  dateTo?: string;
  // Import-time repository selection: when non-empty, only these repositories (by
  // name) are fetched, so every repo-derived metric is computed from exactly this
  // set. Empty/undefined = all repositories. (Work items are project-scoped in
  // Azure DevOps and are not affected by this selection.)
  repositories?: string[];
}

export interface AzureDevOpsCommit {
  commitId: string;
  author: {
    name: string;
    email: string;
    date: string;
  };
  comment: string;
  changeCounts?: {
    Add: number;
    Edit: number;
    Delete: number;
  };
  repoName?: string;
}

export interface AzureDevOpsPullRequest {
  pullRequestId: number;
  title: string;
  status: string;
  createdBy: {
    displayName: string;
    uniqueName?: string;
  };
  closedDate?: string;
  creationDate: string;
  reviewers?: Array<{
    displayName: string;
    vote: number;
    uniqueName?: string;
  }>;
  repository?: {
    id: string;
    name: string;
  };
}

export interface AzureDevOpsWorkItem {
  id: number;
  fields: {
    "System.Title": string;
    "System.WorkItemType": string;
    "System.State": string;
    "System.AssignedTo"?: {
      displayName: string;
      uniqueName?: string;
    };
    "Microsoft.VSTS.Scheduling.StoryPoints"?: number;
    "System.CreatedDate": string;
    "System.AreaPath"?: string;
  };
}

// A single revision from a work item's update history (/wit/workItems/{id}/updates).
// `revisedBy` is the person who made the change; `fields` holds the before/after
// value for each field touched by that revision.
export interface AzureDevOpsWorkItemUpdate {
  revisedBy?: {
    displayName?: string;
    uniqueName?: string;
  };
  fields?: {
    "System.State"?: { oldValue?: string; newValue?: string };
  };
}

// Who moved a bug into a "Resolved" state and who moved it into a validated
// ("Done"/"Closed"/"Completed") state — the real state-transition actors.
export interface BugStateActor {
  resolvedBy?: string;
  resolvedByUnique?: string;
  validatedBy?: string;
  validatedByUnique?: string;
}

// ---------------------------------------------------------------------------
// Metric definitions
// Every KPI is derived here so the numbers are computed consistently across the
// project-level stats, per-contributor stats, per-module stats, highlights and
// fun facts — and so each definition can be documented and traced (see the
// `meta.definitions` block attached to the wrapped data).
// ---------------------------------------------------------------------------

// Work item states that count as "completed" across the common Azure DevOps
// process templates: Scrum (Done), Agile (Resolved/Closed) and CMMI
// (Resolved/Closed). Compared case-insensitively.
const DONE_STATES = new Set(["done", "closed", "resolved", "completed"]);

const DONE_STATES_LABEL = "Done, Closed, Resolved or Completed";

export function isDoneState(state?: string): boolean {
  return !!state && DONE_STATES.has(state.trim().toLowerCase());
}

export function isBug(wi: AzureDevOpsWorkItem): boolean {
  return (wi.fields["System.WorkItemType"] || "").trim().toLowerCase() === "bug";
}

// A bug counts as "fixed" when it is a Bug work item in a completed state.
export function isBugFixed(wi: AzureDevOpsWorkItem): boolean {
  return isBug(wi) && isDoneState(wi.fields["System.State"]);
}

// Custom bug workflow split used only for the "Bug Slayer" (developer) vs
// "Validation Hero" (tester) attribution:
//   • a developer moves a bug to "Resolved"
//   • a tester/validator moves it to a final state ("Done"/"Closed"/"Completed")
// These credits are based on the ACTUAL state-transition actor read from work
// item history (see extractBugStateActors), never the current assignee.
const RESOLVED_STATES = new Set(["resolved"]);
const VALIDATED_STATES = new Set(["done", "closed", "completed"]);

export function isResolvedState(state?: string): boolean {
  return !!state && RESOLVED_STATES.has(state.trim().toLowerCase());
}

export function isValidatedState(state?: string): boolean {
  return !!state && VALIDATED_STATES.has(state.trim().toLowerCase());
}

// From a bug's full update history, find who moved it INTO a Resolved state and
// who moved it INTO a validated (Done/Closed/Completed) state. Returns the last
// person to perform each transition — the actor Azure DevOps recorded on the
// revision — or undefined when that transition never happened. This is the
// state-transition actor, deliberately NOT the current assignee.
export function extractBugStateActors(updates: AzureDevOpsWorkItemUpdate[]): BugStateActor {
  const result: BugStateActor = {};
  for (const u of updates) {
    const change = u.fields?.["System.State"];
    if (!change) continue;
    const to = change.newValue;
    const actor = u.revisedBy?.displayName?.trim();
    if (!to || !actor) continue;
    if (isResolvedState(to)) {
      result.resolvedBy = actor;
      result.resolvedByUnique = u.revisedBy?.uniqueName?.trim().toLowerCase();
    } else if (isValidatedState(to)) {
      result.validatedBy = actor;
      result.validatedByUnique = u.revisedBy?.uniqueName?.trim().toLowerCase();
    }
  }
  return result;
}

// Story points are only credited once the work item reaches a completed state,
// matching the "story points delivered / done" label shown in the UI.
export function completedStoryPoints(wi: AzureDevOpsWorkItem): number {
  return isDoneState(wi.fields["System.State"])
    ? wi.fields["Microsoft.VSTS.Scheduling.StoryPoints"] || 0
    : 0;
}

// True when an ISO date string falls within an optional [from, to] window.
// `to` is treated as inclusive of the whole day (dates are compared as UTC).
export function withinRange(dateIso?: string, from?: string, to?: string): boolean {
  if (!from && !to) return true;
  if (!dateIso) return false;
  const t = new Date(dateIso).getTime();
  if (Number.isNaN(t)) return false;
  if (from && t < new Date(from).getTime()) return false;
  // Add one day (minus 1ms) so a "to" of 2024-12-31 includes all of that day.
  if (to && t > new Date(to).getTime() + 24 * 60 * 60 * 1000 - 1) return false;
  return true;
}

async function fetchAzureDevOps<T>(
  config: AzureDevOpsConfig,
  apiPath: string,
  apiVersion: string = "7.0",
  method: string = "GET",
  body?: string
): Promise<T> {
  // Support both cloud (dev.azure.com) and on-premises Azure DevOps Server
  // For on-premises: baseUrl is server URL, organization is collection name
  // For cloud: organization is the Azure DevOps organization name
  
  // For on-premises, we may need to handle URL encoding of collection names with spaces
  // Try both encoded and decoded versions if needed
  const encodedOrg = encodeURIComponent(config.organization);
  const encodedProject = encodeURIComponent(config.project);
  
  const baseUrl = config.baseUrl 
    ? `${config.baseUrl}/${encodedOrg}/${encodedProject}/_apis`
    : `https://dev.azure.com/${encodedOrg}/${encodedProject}/_apis`;
  const url = `${baseUrl}${apiPath}${apiPath.includes("?") ? "&" : "?"}api-version=${apiVersion}`;

  console.log(`[Azure DevOps] API Request:`);
  console.log(`  Method: ${method}`);
  console.log(`  Base URL: ${config.baseUrl || 'Azure DevOps cloud'}`);
  console.log(`  Collection/Org: ${config.organization}`);
  console.log(`  Project: ${config.project}`);
  console.log(`  API Path: ${apiPath}`);
  console.log(`  Full URL: ${url}`);

  // For on-premises Azure DevOps Server with self-signed certificates
  if (config.baseUrl && url.startsWith("https://")) {
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
    console.log(`[Azure DevOps] SSL verification disabled for self-signed certificate`);
  }

  const fetchOptions: RequestInit = {
    method,
    headers: {
      Authorization: `Basic ${Buffer.from(`:${config.personalAccessToken}`).toString("base64")}`,
      "Content-Type": "application/json",
    },
  };

  if (body) {
    fetchOptions.body = body;
  }

  const response = await fetch(url, fetchOptions);

  if (!response.ok) {
    const errorText = await response.text();
    console.error(`[Azure DevOps] API error: ${response.status} - ${errorText}`);
    
    if (response.status === 401) {
      throw new Error("Authentication failed. Please check your Personal Access Token has the correct permissions (Code: Read, Work Items: Read).");
    } else if (response.status === 404) {
      throw new Error(`Resource not found at: ${url}\n\nPlease verify:\n1. Base URL is correct: ${config.baseUrl || "https://dev.azure.com"}\n2. Organization/Collection name: ${config.organization}\n3. Project name: ${config.project}`);
    } else if (response.status === 403) {
      throw new Error("Access denied. Your PAT may not have sufficient permissions. Required: Code (Read), Work Items (Read).");
    }
    
    throw new Error(`Azure DevOps API error (${response.status}): ${errorText}`);
  }

  return response.json();
}

// ---------------------------------------------------------------------------
// Import completeness tracking
// Records where data could NOT be fetched so the recap can tell the user when
// the numbers may be incomplete, instead of presenting partial data as whole.
// Only counts and short human-readable messages are ever kept here — never raw
// error objects, response bodies, tokens or other secrets.
// ---------------------------------------------------------------------------

export interface RepoFailure {
  repo: string;
  reason: string;
}

export interface ImportCompleteness {
  repositoryListFailed: boolean; // the /git/repositories call itself failed
  repositoriesFound: number; // repos returned by the list
  commitReposFailed: number; // repos whose commit paging threw
  pullRequestReposFailed: number; // repos whose PR paging threw
  commitsCategoryFailed: boolean; // the whole commit fetch rejected
  pullRequestsCategoryFailed: boolean; // the whole PR fetch rejected
  workItemsCategoryFailed: boolean; // the whole work-item fetch rejected (e.g. WIQL failed)
  workItemIdsFound: number; // work item ids discovered via WIQL
  workItemDetailsFetched: number; // work items whose details we actually loaded
  workItemDetailBatchesFailed: number; // detail batches that failed and were skipped
  bugHistoryRequested: number; // bugs whose state history we attempted to read
  bugHistoryFetched: number; // bugs whose state history we successfully read
  bugHistoryFailed: number; // bugs whose state-history call threw and was skipped
  commitFailures: RepoFailure[]; // per-repo commit failure diagnostics
  pullRequestFailures: RepoFailure[]; // per-repo PR failure diagnostics
}

export function newCompleteness(): ImportCompleteness {
  return {
    repositoryListFailed: false,
    repositoriesFound: 0,
    commitReposFailed: 0,
    pullRequestReposFailed: 0,
    commitsCategoryFailed: false,
    pullRequestsCategoryFailed: false,
    workItemsCategoryFailed: false,
    workItemIdsFound: 0,
    workItemDetailsFetched: 0,
    workItemDetailBatchesFailed: 0,
    bugHistoryRequested: 0,
    bugHistoryFetched: 0,
    bugHistoryFailed: 0,
    commitFailures: [],
    pullRequestFailures: [],
  };
}

// Turn an error into a short, safe reason string. Auth material is never present
// in these messages (the PAT lives in a header), but we scrub defensively anyway
// and keep only the first line, truncated.
export function sanitizeFailureReason(error: unknown): string {
  let msg = error instanceof Error && error.message ? error.message : String(error);
  msg = msg
    .replace(/Basic\s+[A-Za-z0-9+/=]+/g, "Basic ***")
    .replace(/Bearer\s+[A-Za-z0-9._-]+/g, "Bearer ***");
  return msg.split("\n")[0].trim().slice(0, 200);
}

export interface CompletenessSummary {
  status: "complete" | "partial" | "failed";
  warnings: string[];
  repositories: { found: number; commitFetchFailed: number; pullRequestFetchFailed: number };
  workItems: { idsFound: number; detailsFetched: number; detailBatchesFailed: number };
  commitFailures: RepoFailure[];
  pullRequestFailures: RepoFailure[];
}

// Turn the raw tracker into a saved, user-facing summary: an overall status and
// plain-language warnings that say what is missing and which numbers it affects.
export function summarizeCompleteness(c: ImportCompleteness): CompletenessSummary {
  const warnings: string[] = [];

  if (c.repositoryListFailed) {
    warnings.push("Could not list repositories — most commit and pull request data is likely missing.");
  } else if (c.repositoriesFound === 0) {
    warnings.push("No repositories were returned for this project, so commit, pull request and repository metrics are empty.");
  }

  if (c.commitsCategoryFailed) {
    warnings.push("Commit data could not be fetched — commit counts, streaks and activity patterns are missing.");
  } else if (c.commitReposFailed > 0) {
    warnings.push(
      `Commits could not be read from ${c.commitReposFailed} of ${c.repositoriesFound} repositories, so commit-based numbers are undercounted.`
    );
  }

  if (c.pullRequestsCategoryFailed) {
    warnings.push("Pull request data could not be fetched — PR, review and merge-time metrics are missing.");
  } else if (c.pullRequestReposFailed > 0) {
    warnings.push(
      `Pull requests could not be read from ${c.pullRequestReposFailed} of ${c.repositoriesFound} repositories, so PR and review numbers are undercounted.`
    );
  }

  if (c.workItemsCategoryFailed) {
    warnings.push("Work item data could not be fetched — bug, story-point and work-area metrics are missing.");
  } else {
    const missing = Math.max(0, c.workItemIdsFound - c.workItemDetailsFetched);
    if (c.workItemDetailBatchesFailed > 0 || missing > 0) {
      warnings.push(
        `${missing.toLocaleString()} of ${c.workItemIdsFound.toLocaleString()} work items could not be loaded and are excluded, so bug and story-point numbers are undercounted.`
      );
    }
  }

  if (c.bugHistoryRequested > 0) {
    const missing = Math.max(0, c.bugHistoryRequested - c.bugHistoryFetched);
    if (missing > 0) {
      warnings.push(
        `Bug state history could not be read for ${missing.toLocaleString()} of ${c.bugHistoryRequested.toLocaleString()} bugs, so the "Resolved by" / "Validated by" credits for those bugs are missing.`
      );
    }
  }

  const everythingFailed =
    c.commitsCategoryFailed && c.pullRequestsCategoryFailed && c.workItemsCategoryFailed;

  let status: CompletenessSummary["status"];
  if (c.repositoryListFailed || everythingFailed) {
    status = "failed";
  } else if (warnings.length > 0) {
    status = "partial";
  } else {
    status = "complete";
  }

  return {
    status,
    warnings,
    repositories: {
      found: c.repositoriesFound,
      commitFetchFailed: c.commitReposFailed,
      pullRequestFetchFailed: c.pullRequestReposFailed,
    },
    workItems: {
      idsFound: c.workItemIdsFound,
      detailsFetched: c.workItemDetailsFetched,
      detailBatchesFailed: c.workItemDetailBatchesFailed,
    },
    commitFailures: c.commitFailures,
    pullRequestFailures: c.pullRequestFailures,
  };
}

// Import-time repository selection. Empty selection (or no valid names) = include
// all repositories; otherwise keep only the repositories whose name was selected.
// This is what makes repository filtering accurate: the returned set is the only
// one whose commits/PRs are fetched, so every repo-derived number reflects it.
// Azure DevOps lists disabled repositories, but every commit/PR call on one
// returns 404 (TF401019). They hold no readable data, so leave them out instead
// of counting them as failed fetches that mark the recap partial.
export function splitDisabledRepositories<T extends { name: string; isDisabled?: boolean }>(
  all: T[]
): { active: T[]; disabled: string[] } {
  const active: T[] = [];
  const disabled: string[] = [];
  for (const r of all) {
    if (r.isDisabled === true) disabled.push(r.name);
    else active.push(r);
  }
  return { active, disabled };
}

export function selectRepositories<T extends { name: string }>(all: T[], selected: string[]): T[] {
  const wanted = selected.filter(n => n && n.trim());
  if (wanted.length === 0) return all;
  const set = new Set(wanted);
  return all.filter(r => set.has(r.name));
}

export async function fetchAzureDevOpsData(config: AzureDevOpsConfig): Promise<ProjectWrappedData> {
  const dateFrom = config.dateFrom;
  const dateTo = config.dateTo;

  console.log(`[Azure DevOps] Fetching data for ${config.organization}/${config.project}`);
  if (dateFrom && dateTo) {
    console.log(`[Azure DevOps] Date range: ${dateFrom} to ${dateTo}`);
  } else {
    console.log(`[Azure DevOps] Fetching all commits (no date filter)`);
  }

  // Track import completeness so partial data is never presented as whole.
  const tracker = newCompleteness();

  // Fetch repositories (for repo-level stats) and iterations (for real sprints).
  const [{ active: allRepositories, disabled: disabledRepositories }, iterations] = await Promise.all([
    fetchRepositories(config, tracker),
    fetchIterations(config),
  ]);
  if (disabledRepositories.length > 0) {
    console.log(`[Azure DevOps] Skipping ${disabledRepositories.length} disabled repositories: ${disabledRepositories.join(", ")}`);
  }

  // Apply the import-time repository selection: only fetch commits/PRs for the
  // selected repositories so every repo-derived number is genuinely accurate.
  const selected = config.repositories?.filter(n => n && n.trim()) ?? [];
  const repositories = selectRepositories(allRepositories, selected);
  const repositoryFilterApplied = selected.length > 0 && repositories.length !== allRepositories.length;
  if (repositoryFilterApplied) {
    console.log(`[Azure DevOps] Repository filter: ${repositories.length} of ${allRepositories.length} repositories selected`);
  }
  // Reflect the *selected* repositories in the completeness repo count.
  tracker.repositoriesFound = repositories.length;

  // Fetch each category independently: a failure in one (e.g. work items) should
  // still yield a partial recap with a clear warning, not a blank 500 error.
  const [commitsRes, prsRes, workItemsRes] = await Promise.allSettled([
    fetchCommits(config, repositories, dateFrom, dateTo, tracker),
    fetchPullRequests(config, repositories, dateFrom, dateTo, tracker),
    fetchWorkItems(config, dateFrom, dateTo, tracker),
  ]);

  let commits: AzureDevOpsCommit[] = [];
  if (commitsRes.status === "fulfilled") {
    commits = commitsRes.value;
  } else {
    tracker.commitsCategoryFailed = true;
    console.error("[Azure DevOps] Commit fetch failed entirely:", commitsRes.reason);
  }

  let pullRequests: AzureDevOpsPullRequest[] = [];
  if (prsRes.status === "fulfilled") {
    pullRequests = prsRes.value;
  } else {
    tracker.pullRequestsCategoryFailed = true;
    console.error("[Azure DevOps] Pull request fetch failed entirely:", prsRes.reason);
  }

  let workItems: AzureDevOpsWorkItem[] = [];
  if (workItemsRes.status === "fulfilled") {
    workItems = workItemsRes.value;
  } else {
    tracker.workItemsCategoryFailed = true;
    console.error("[Azure DevOps] Work item fetch failed entirely:", workItemsRes.reason);
  }

  console.log(`[Azure DevOps] Fetched: ${commits.length} commits, ${pullRequests.length} PRs, ${workItems.length} work items`);

  // If the import produced no usable data *because of failures*, surface the error
  // loudly (500 → error toast) instead of saving an empty recap that a partial-data
  // banner cannot rescue. A genuinely empty project (no failures) still proceeds.
  if (commits.length === 0 && pullRequests.length === 0 && workItems.length === 0) {
    const hadFailure =
      tracker.repositoryListFailed ||
      tracker.commitsCategoryFailed ||
      tracker.pullRequestsCategoryFailed ||
      tracker.workItemsCategoryFailed;
    if (hadFailure) {
      const summary = summarizeCompleteness(tracker);
      throw new Error(
        `Azure DevOps import failed — no data could be retrieved. ${summary.warnings.join(" ")}`
      );
    }
  }

  // Calculate enhanced stats
  const prMergeStats = calculatePrMergeStats(pullRequests);
  const activityPattern = calculateActivityPattern(commits);
  const streakData = calculateStreaks(commits);
  const repoStats = aggregateRepositoryStats(commits, pullRequests, repositories);
  const workItemBreakdown = aggregateWorkItemTypes(workItems);

  // Read the real state-transition actors for bugs (who moved each bug to
  // Resolved vs. to a validated state) so "Bug Slayer" and "Validation Hero" are
  // credited to the actual person, not the current assignee. Non-fatal: any
  // failures are disclosed via completeness, and bugs stay uncredited.
  const bugs = workItems.filter(isBug);
  const bugActors = await fetchBugStateActors(config, bugs, tracker);

  // Aggregate per raw identity, then merge into canonical people so the same
  // human isn't split across git/Azure identities. Every contributor-based
  // section (Champions, Top 5, Team) is computed from this one canonical set.
  const rawContributors = aggregateContributorStats(commits, pullRequests, workItems, prMergeStats, streakData, bugActors);
  const contributorStats = canonicalizeContributors(rawContributors);
  const moduleStats = aggregateModuleStats(workItems);
  const top5 = calculateTop5(contributorStats, commits, streakData);
  const highlights = generateHighlights(commits, pullRequests, workItems, activityPattern);
  const funFacts = generateFunFacts(commits, pullRequests, workItems, activityPattern, prMergeStats, streakData);
  const milestones = generateMilestones(commits, pullRequests, workItems, dateFrom, dateTo);

  // A "review" = a reviewer who actually cast a vote (approve/reject/waiting), not just an assigned reviewer.
  const totalReviews = pullRequests.reduce(
    (acc, pr) => acc + (pr.reviewers?.filter(r => r.vote !== 0).length || 0),
    0
  );
  const mergedPrs = pullRequests.filter(pr => pr.status === "completed").length;
  const totalStats = {
    totalCommits: commits.length,
    totalPullRequests: pullRequests.length,
    totalReviews,
    // Per-PR comment threads cannot be scanned at project scale (thousands of PRs) without
    // timing out, so we do not report a comment count rather than showing a misleading partial number.
    totalComments: 0,
    totalBugsFixed: workItems.filter(isBugFixed).length,
    totalStoryPointsDone: workItems.reduce((acc, wi) => acc + completedStoryPoints(wi), 0),
    // Real Azure DevOps iterations overlapping the range. We never estimate a
    // sprint count from the date range (cadence varies — 2 or 3 weeks), so when
    // iterations can't be read this stays 0 and the UI hides the sprint text.
    sprintsCompleted: iterations.length > 0
      ? countIterationsInRange(iterations, dateFrom, dateTo)
      : 0,
    totalRepositories: repositories.length,
    avgPrMergeTimeHours: prMergeStats.avgMergeTimeHours,
    fastestPrMergeTimeHours: prMergeStats.fastestMergeTimeHours,
    longestStreak: streakData.longestStreak,
    totalWorkItems: workItems.length,
    prMergeRate: pullRequests.length > 0 ? Math.round((mergedPrs / pullRequests.length) * 100) : 0,
  };

  console.log(`[Azure DevOps] Aggregated ${contributorStats.length} contributors, ${moduleStats.length} modules`);

  // For a full-project recap (no explicit date range), derive the range from the
  // actual commit history so the wrap reflects the entire project lifetime.
  // NOTE: iterate instead of spreading into Math.min/Math.max — the commit array can hold
  // tens of thousands of entries and spreading it as function args overflows the call stack.
  let minCommitTs = Infinity;
  let maxCommitTs = -Infinity;
  for (const c of commits) {
    const t = new Date(c.author.date).getTime();
    if (Number.isNaN(t)) continue;
    if (t < minCommitTs) minCommitTs = t;
    if (t > maxCommitTs) maxCommitTs = t;
  }
  const hasCommitDates = minCommitTs !== Infinity;
  const derivedStart = hasCommitDates
    ? new Date(minCommitTs).toISOString().split("T")[0]
    : new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];
  const derivedEnd = hasCommitDates
    ? new Date(maxCommitTs).toISOString().split("T")[0]
    : new Date().toISOString().split("T")[0];

  const rangeStart = dateFrom || derivedStart;
  const rangeEnd = dateTo || derivedEnd;

  // Provenance / methodology so every headline number is traceable back to the
  // source query, the filters applied and the definitions used to compute it.
  const meta = {
    source: "Azure DevOps",
    generatedAt: new Date().toISOString(),
    organization: config.organization,
    project: config.project,
    // baseUrl is the server address only — the PAT is never included.
    baseUrl: config.baseUrl || "https://dev.azure.com",
    filters: {
      dateFrom: dateFrom || undefined,
      dateTo: dateTo || undefined,
      dateField: dateFrom || dateTo
        ? "Commits by commit date, PRs by creation date, work items by created date"
        : "None — full project history",
    },
    repositoriesIncluded: repositories.map(r => r.name),
    counts: {
      commits: commits.length,
      pullRequests: pullRequests.length,
      workItems: workItems.length,
      repositories: repositories.length,
    },
    definitions: [
      `Work items counted: every work item type (Tasks included), in any state, filtered by created date (System.CreatedDate) when a date range is set, scoped to this project. Repository selection does not change work items — they are project-scoped in Azure DevOps.`,
      `Bugs fixed: work items of type "Bug" in a completed state (${DONE_STATES_LABEL}) — based on current state, not on who resolved vs. validated them.`,
      `Bug Slayer (bugs resolved): bugs a developer moved into the "Resolved" state, credited to the person who performed that transition (from work item history), not the current assignee.`,
      `Validation Hero (bugs validated): bugs a tester moved into a validated state (Done/Closed/Completed), credited to the person who performed that transition (from work item history), not the current assignee.`,
      `Story points: sum of Story Points on work items in a completed state (${DONE_STATES_LABEL}).`,
      "Code reviews: reviewers who cast a vote (approved, approved w/ suggestions, waiting or rejected) on a PR.",
      "PR merge rate: completed PRs ÷ all PRs in range.",
      "Longest streak: most consecutive calendar days with at least one commit, per author.",
      "Work Areas: grouped by the leaf of each work item's Area Path; commits and PRs cannot be attributed to an area path, so only work-item counts are shown there.",
    ],
    notes: [
      ...(repositoryFilterApplied
        ? [
            `This recap includes only ${repositories.length} of ${allRepositories.length} repositories, selected at import — commit, pull request and repository metrics reflect only those. Work items are project-scoped in Azure DevOps and are not affected by repository selection.`,
          ]
        : []),
      ...(disabledRepositories.length > 0
        ? [
            `${disabledRepositories.length} disabled Azure DevOps ${disabledRepositories.length === 1 ? "repository was" : "repositories were"} skipped because their commits and pull requests cannot be read: ${disabledRepositories.join(", ")}.`,
          ]
        : []),
      "PR discussion comments and lines-added/deleted are not collected — scanning every PR thread at project scale is too slow, so those metrics are intentionally omitted rather than shown partially.",
      "Contributors are unified into one person per Azure DevOps account by matching email / unique name, then exact display name. Commits from linked git identities are summed into that person; git identities with no Azure match are shown separately and can be linked manually in Settings → Contributors.",
      "Bug 'resolved by developer' (Bug Slayer) and 'validated by tester' (Validation Hero) are read from each bug's work item history and credited to the person who performed that state transition — not the current assignee. Bugs whose history could not be read carry no such credit (see completeness warnings).",
      "Activity hours (busiest hour, night owl / early bird) are computed in the server's local timezone.",
      iterations.length > 0
        ? `Sprints completed = the ${totalStats.sprintsCompleted} Azure DevOps iteration(s) overlapping the selected range (real iterations, not an estimate).`
        : "Sprint count is hidden: real Azure DevOps iterations could not be read for this project, and sprint length is not fixed (2–3 weeks), so it is not estimated from the date range.",
    ],
    completeness: summarizeCompleteness(tracker),
  };

  return {
    projectName: config.project,
    version: "",
    dateRange: {
      start: rangeStart,
      end: rangeEnd,
    },
    stats: totalStats,
    contributors: contributorStats,
    modules: moduleStats,
    top5,
    highlights,
    milestones,
    // Enhanced data
    repositories: repoStats,
    activityPattern,
    funFacts,
    workItemBreakdown,
    meta,
  };
}

// Helper function to fetch repositories
async function fetchRepositories(
  config: AzureDevOpsConfig,
  tracker?: ImportCompleteness
): Promise<{ active: Array<{ id: string; name: string }>; disabled: string[] }> {
  try {
    const reposResponse = await fetchAzureDevOps<{
      value: Array<{ id: string; name: string; isDisabled?: boolean }>;
    }>(config, "/git/repositories");
    const split = splitDisabledRepositories(reposResponse.value || []);
    if (tracker) tracker.repositoriesFound = split.active.length;
    return split;
  } catch (error) {
    console.warn("[Azure DevOps] Failed to fetch repositories:", error);
    if (tracker) tracker.repositoryListFailed = true;
    return { active: [], disabled: [] };
  }
}

interface AzureIterationNode {
  name: string;
  attributes?: { startDate?: string; finishDate?: string };
  children?: AzureIterationNode[];
}

// Fetch the project's iteration (sprint) tree. Uses the project-level
// classification nodes API, so no team context is required. Returns dated
// iterations flattened from the tree; on any failure returns [] (non-fatal).
async function fetchIterations(
  config: AzureDevOpsConfig
): Promise<Array<{ name: string; startDate?: string; finishDate?: string }>> {
  try {
    const root = await fetchAzureDevOps<AzureIterationNode>(
      config,
      "/wit/classificationnodes/iterations?$depth=10"
    );
    const out: Array<{ name: string; startDate?: string; finishDate?: string }> = [];
    const walk = (node: AzureIterationNode) => {
      const startDate = node.attributes?.startDate;
      const finishDate = node.attributes?.finishDate;
      if (startDate || finishDate) out.push({ name: node.name, startDate, finishDate });
      for (const child of node.children || []) walk(child);
    };
    walk(root);
    console.log(`[Azure DevOps] Found ${out.length} dated iterations`);
    return out;
  } catch (error) {
    console.warn("[Azure DevOps] Failed to fetch iterations (falling back to estimate):", error);
    return [];
  }
}

// Count iterations that overlap [from, to]. With no range, counts all dated
// iterations. An iteration overlaps when it starts on/before the window end and
// finishes on/after the window start.
export function countIterationsInRange(
  iterations: Array<{ startDate?: string; finishDate?: string }>,
  from?: string,
  to?: string
): number {
  return iterations.filter(it => {
    if (!it.startDate && !it.finishDate) return false;
    if (!from && !to) return true;
    const start = it.startDate ? new Date(it.startDate).getTime() : -Infinity;
    const finish = it.finishDate ? new Date(it.finishDate).getTime() : Infinity;
    const lo = from ? new Date(from).getTime() : -Infinity;
    const hi = to ? new Date(to).getTime() + 24 * 60 * 60 * 1000 - 1 : Infinity;
    return start <= hi && finish >= lo;
  }).length;
}

// Calculate PR merge time statistics
export function calculatePrMergeStats(pullRequests: AzureDevOpsPullRequest[]): {
  avgMergeTimeHours: number; 
  fastestMergeTimeHours: number;
  mergeTimeByAuthor: Map<string, number[]>;
} {
  const mergeTimeByAuthor = new Map<string, number[]>();
  let mergeCount = 0;
  let mergeSum = 0;
  let fastestMerge = Infinity;

  for (const pr of pullRequests) {
    if (pr.status === "completed" && pr.closedDate && pr.creationDate) {
      const created = new Date(pr.creationDate).getTime();
      const closed = new Date(pr.closedDate).getTime();
      const hoursToMerge = (closed - created) / (1000 * 60 * 60);

      if (hoursToMerge > 0 && hoursToMerge < 8760) { // Less than 1 year
        mergeCount++;
        mergeSum += hoursToMerge;
        if (hoursToMerge < fastestMerge) fastestMerge = hoursToMerge;

        const author = pr.createdBy.displayName;
        if (!mergeTimeByAuthor.has(author)) {
          mergeTimeByAuthor.set(author, []);
        }
        mergeTimeByAuthor.get(author)!.push(hoursToMerge);
      }
    }
  }

  return {
    avgMergeTimeHours: mergeCount > 0 ? Math.round(mergeSum / mergeCount) : 0,
    fastestMergeTimeHours: mergeCount > 0 ? Math.round(fastestMerge * 10) / 10 : 0,
    mergeTimeByAuthor,
  };
}

// Calculate activity patterns (hour of day, day of week)
function calculateActivityPattern(commits: AzureDevOpsCommit[]): ActivityPattern {
  const hourlyDistribution = new Array(24).fill(0);
  const dailyDistribution = new Array(7).fill(0);
  const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

  for (const commit of commits) {
    const date = new Date(commit.author.date);
    hourlyDistribution[date.getHours()]++;
    dailyDistribution[date.getDay()]++;
  }

  const busiestHour = hourlyDistribution.indexOf(Math.max(...hourlyDistribution));
  const busiestDayIndex = dailyDistribution.indexOf(Math.max(...dailyDistribution));
  
  let peakProductivityTime: string;
  if (busiestHour >= 5 && busiestHour < 12) {
    peakProductivityTime = "Morning";
  } else if (busiestHour >= 12 && busiestHour < 17) {
    peakProductivityTime = "Afternoon";
  } else if (busiestHour >= 17 && busiestHour < 21) {
    peakProductivityTime = "Evening";
  } else {
    peakProductivityTime = "Night";
  }

  return {
    hourlyDistribution,
    dailyDistribution,
    busiestHour,
    busiestDay: dayNames[busiestDayIndex],
    peakProductivityTime,
  };
}

// Calculate commit streaks
export function calculateStreaks(commits: AzureDevOpsCommit[]): {
  longestStreak: number;
  streaksByAuthor: Map<string, number>;
} {
  const commitsByAuthorAndDate = new Map<string, Set<string>>();
  
  for (const commit of commits) {
    const author = commit.author.name;
    const date = commit.author.date.split("T")[0];
    
    if (!commitsByAuthorAndDate.has(author)) {
      commitsByAuthorAndDate.set(author, new Set());
    }
    commitsByAuthorAndDate.get(author)!.add(date);
  }

  const streaksByAuthor = new Map<string, number>();
  let longestStreak = 0;

  Array.from(commitsByAuthorAndDate.entries()).forEach(([author, dates]) => {
    const sortedDates: string[] = Array.from(dates).sort();
    let currentStreak = 1;
    let maxStreak = 1;

    for (let i = 1; i < sortedDates.length; i++) {
      const prevDate = new Date(sortedDates[i - 1]);
      const currDate = new Date(sortedDates[i]);
      const diffDays = (currDate.getTime() - prevDate.getTime()) / (1000 * 60 * 60 * 24);

      if (diffDays === 1) {
        currentStreak++;
        maxStreak = Math.max(maxStreak, currentStreak);
      } else {
        currentStreak = 1;
      }
    }

    streaksByAuthor.set(author, maxStreak);
    longestStreak = Math.max(longestStreak, maxStreak);
  });

  return { longestStreak, streaksByAuthor };
}

// Aggregate repository-level stats from commits and PRs tagged with their repo name.
function aggregateRepositoryStats(
  commits: AzureDevOpsCommit[],
  pullRequests: AzureDevOpsPullRequest[],
  repositories: Array<{ id: string; name: string }>
): RepositoryStats[] {
  const repoStats = new Map<string, RepositoryStats>();
  const contributorsByRepo = new Map<string, Set<string>>();
  const commitsByRepo = new Map<string, number>();

  // Initialize from the repositories list so empty repos still appear.
  for (const repo of repositories) {
    repoStats.set(repo.name, {
      name: repo.name,
      commits: 0,
      pullRequests: 0,
      contributors: 0,
    });
    contributorsByRepo.set(repo.name, new Set());
  }

  // Count commits and unique contributors per repo.
  for (const commit of commits) {
    const repoName = commit.repoName;
    if (!repoName) continue;
    commitsByRepo.set(repoName, (commitsByRepo.get(repoName) || 0) + 1);
    if (!contributorsByRepo.has(repoName)) contributorsByRepo.set(repoName, new Set());
    contributorsByRepo.get(repoName)!.add(commit.author.name);
  }

  // Count PRs per repo.
  const prsByRepo = new Map<string, number>();
  const topContributorByRepo = new Map<string, Map<string, number>>();
  for (const commit of commits) {
    const repoName = commit.repoName;
    if (!repoName) continue;
    if (!topContributorByRepo.has(repoName)) topContributorByRepo.set(repoName, new Map());
    const counts = topContributorByRepo.get(repoName)!;
    counts.set(commit.author.name, (counts.get(commit.author.name) || 0) + 1);
  }
  for (const pr of pullRequests) {
    const repoName = pr.repository?.name;
    if (!repoName) continue;
    prsByRepo.set(repoName, (prsByRepo.get(repoName) || 0) + 1);
  }

  for (const [name, stats] of Array.from(repoStats.entries())) {
    stats.commits = commitsByRepo.get(name) || 0;
    stats.pullRequests = prsByRepo.get(name) || 0;
    stats.contributors = contributorsByRepo.get(name)?.size || 0;

    const counts = topContributorByRepo.get(name);
    if (counts && counts.size > 0) {
      stats.topContributor = Array.from(counts.entries()).sort((a, b) => b[1] - a[1])[0][0];
    }
  }

  return Array.from(repoStats.values())
    .filter(r => r.commits > 0 || r.pullRequests > 0)
    .sort((a, b) => b.commits - a.commits)
    .slice(0, 10);
}

// Aggregate work item types
function aggregateWorkItemTypes(workItems: AzureDevOpsWorkItem[]): Record<string, number> {
  const breakdown: Record<string, number> = {};
  
  for (const wi of workItems) {
    const type = wi.fields["System.WorkItemType"] || "Unknown";
    breakdown[type] = (breakdown[type] || 0) + 1;
  }

  return breakdown;
}

async function fetchCommits(
  config: AzureDevOpsConfig,
  repositories: Array<{ id: string; name: string }>,
  dateFrom?: string,
  dateTo?: string,
  tracker?: ImportCompleteness
): Promise<AzureDevOpsCommit[]> {
  try {
    console.log(`[Azure DevOps] Fetching commits from ${repositories.length} repositories...`);
    const allCommits: AzureDevOpsCommit[] = [];
    const pageSize = 1000;

    for (const repo of repositories) {
      let repoCommitCount = 0;
      try {
        let skip = 0;

        // Page through every commit in the repo using $skip until a short page is returned.
        while (true) {
          let queryString = `searchCriteria.$top=${pageSize}&searchCriteria.$skip=${skip}`;
          if (dateFrom) queryString += `&searchCriteria.fromDate=${dateFrom}`;
          if (dateTo) queryString += `&searchCriteria.toDate=${dateTo}`;

          const commitsResponse = await fetchAzureDevOps<{ value: AzureDevOpsCommit[] }>(
            config,
            `/git/repositories/${repo.id}/commits?${queryString}`
          );

          const page = commitsResponse.value || [];
          for (const commit of page) {
            commit.repoName = repo.name;
          }
          allCommits.push(...page);
          repoCommitCount += page.length;

          if (page.length < pageSize) break;
          skip += pageSize;
        }

        console.log(`[Azure DevOps] ${repo.name}: ${repoCommitCount} commits`);
      } catch (error) {
        console.warn(`[Azure DevOps] Failed to fetch commits for repo ${repo.name}:`, error);
        if (tracker) {
          tracker.commitReposFailed++;
          const base = sanitizeFailureReason(error);
          // Note when some commits were read before the failure (partial, not total).
          const reason = repoCommitCount > 0 ? `${base} (after reading ${repoCommitCount} commits)` : base;
          tracker.commitFailures.push({ repo: repo.name, reason });
        }
      }
    }

    console.log(`[Azure DevOps] Total commits fetched: ${allCommits.length}`);
    return allCommits;
  } catch (error) {
    console.error("[Azure DevOps] Failed to fetch commits:", error);
    throw error;
  }
}

async function fetchPullRequests(
  config: AzureDevOpsConfig,
  repositories: Array<{ id: string; name: string }>,
  dateFrom?: string,
  dateTo?: string,
  tracker?: ImportCompleteness
): Promise<AzureDevOpsPullRequest[]> {
  try {
    console.log(`[Azure DevOps] Fetching pull requests from ${repositories.length} repositories...`);
    const allPRs: AzureDevOpsPullRequest[] = [];
    const pageSize = 1000;

    for (const repo of repositories) {
      let repoPrCount = 0;
      try {
        let skip = 0;

        // Page through every PR (any status) in the repo using $skip.
        while (true) {
          const prsResponse = await fetchAzureDevOps<{ value: AzureDevOpsPullRequest[] }>(
            config,
            `/git/repositories/${repo.id}/pullrequests?searchCriteria.status=all&$top=${pageSize}&$skip=${skip}`
          );

          const page = prsResponse.value || [];
          for (const pr of page) {
            // The per-repo PR list omits the repository object, so attach it for repo-level stats.
            pr.repository = pr.repository || { id: repo.id, name: repo.name };
          }
          allPRs.push(...page);
          repoPrCount += page.length;

          if (page.length < pageSize) break;
          skip += pageSize;
        }

        console.log(`[Azure DevOps] ${repo.name}: ${repoPrCount} pull requests`);
      } catch (error) {
        console.warn(`[Azure DevOps] Failed to fetch PRs for repo ${repo.name}:`, error);
        if (tracker) {
          tracker.pullRequestReposFailed++;
          const base = sanitizeFailureReason(error);
          const reason = repoPrCount > 0 ? `${base} (after reading ${repoPrCount} PRs)` : base;
          tracker.pullRequestFailures.push({ repo: repo.name, reason });
        }
      }
    }

    // Scope PRs to the requested date range (by creation date) so PR-derived
    // metrics stay consistent with the commit and work-item metrics, which are
    // filtered on the same window. The PR list API has no reliable server-side
    // date filter, so we filter here after fetching.
    const scopedPRs = (dateFrom || dateTo)
      ? allPRs.filter(pr => withinRange(pr.creationDate, dateFrom, dateTo))
      : allPRs;

    if (scopedPRs.length !== allPRs.length) {
      console.log(`[Azure DevOps] Pull requests in date range: ${scopedPRs.length} of ${allPRs.length} fetched`);
    } else {
      console.log(`[Azure DevOps] Total pull requests fetched: ${allPRs.length}`);
    }
    return scopedPRs;
  } catch (error) {
    console.error("[Azure DevOps] Failed to fetch pull requests:", error);
    throw error;
  }
}

async function fetchWorkItems(
  config: AzureDevOpsConfig,
  dateFrom?: string,
  dateTo?: string,
  tracker?: ImportCompleteness
): Promise<AzureDevOpsWorkItem[]> {
  // A single WIQL query returns at most 20,000 rows. To retrieve every work item in a large
  // project we page by an ascending [System.Id] watermark, asking for the next chunk of IDs
  // greater than the highest ID we've seen so far, until a short page signals the end.
  const WIQL_MAX = 20000;
  // Only request the fields the wrap actually uses (much lighter/faster than $expand=all).
  const detailFields = [
    "System.Id",
    "System.Title",
    "System.WorkItemType",
    "System.State",
    "System.AssignedTo",
    "Microsoft.VSTS.Scheduling.StoryPoints",
    "System.CreatedDate",
    "System.AreaPath",
  ].join(",");

  // Escape single quotes for safe WIQL string literals.
  const projectLiteral = config.project.replace(/'/g, "''");

  try {
    console.log(`[Azure DevOps] Querying work item IDs (paging by ID watermark)...`);

    const baseFilters = [`[System.TeamProject] = '${projectLiteral}'`];
    if (dateFrom && dateTo) {
      baseFilters.push(`[System.CreatedDate] >= '${dateFrom}'`);
      baseFilters.push(`[System.CreatedDate] <= '${dateTo}'`);
    }

    const allWorkItemIds: number[] = [];
    let lastId = 0;
    while (true) {
      const whereClause = [...baseFilters, `[System.Id] > ${lastId}`].join(" AND ");
      const wiqlQuery = {
        query: `SELECT [System.Id] FROM workitems WHERE ${whereClause} ORDER BY [System.Id] ASC`,
      };

      const queryData = await fetchAzureDevOps<{ workItems: Array<{ id: number }> }>(
        config,
        `/wit/wiql`,
        "7.0",
        "POST",
        JSON.stringify(wiqlQuery)
      );

      const ids = queryData.workItems?.map(wi => wi.id) || [];
      if (ids.length === 0) break;

      for (const id of ids) allWorkItemIds.push(id); // avoid spread on a 20k array (stack safety)
      lastId = ids[ids.length - 1];
      console.log(`[Azure DevOps] Collected ${allWorkItemIds.length} work item IDs so far (up to id ${lastId})`);

      if (ids.length < WIQL_MAX) break;
    }

    console.log(`[Azure DevOps] Found ${allWorkItemIds.length} work items total`);
    if (tracker) tracker.workItemIdsFound = allWorkItemIds.length;

    if (allWorkItemIds.length === 0) {
      return [];
    }

    // Build batches of 200 IDs (Azure DevOps limit for the batch GET).
    const batchSize = 200;
    const batches: number[][] = [];
    for (let i = 0; i < allWorkItemIds.length; i += batchSize) {
      batches.push(allWorkItemIds.slice(i, i + batchSize));
    }

    console.log(`[Azure DevOps] Fetching details for ${allWorkItemIds.length} work items in ${batches.length} batches...`);

    // Fetch batches with limited concurrency to keep it reasonably fast without hammering the server.
    const concurrency = 5;
    const workItems: AzureDevOpsWorkItem[] = [];
    for (let i = 0; i < batches.length; i += concurrency) {
      const slice = batches.slice(i, i + concurrency);
      const results = await Promise.all(
        slice.map(async (batch, idx) => {
          const batchNumber = i + idx + 1;
          try {
            const detailsData = await fetchAzureDevOps<{ value: AzureDevOpsWorkItem[] }>(
              config,
              `/wit/workitems?ids=${batch.join(",")}&fields=${detailFields}`
            );
            return detailsData.value || [];
          } catch {
            console.warn(`[Azure DevOps] Error fetching work item batch ${batchNumber}, skipping it`);
            if (tracker) tracker.workItemDetailBatchesFailed++;
            return [] as AzureDevOpsWorkItem[];
          }
        })
      );
      for (const list of results) {
        for (const wi of list) workItems.push(wi);
      }
      console.log(`[Azure DevOps] Work item details progress: ${workItems.length}/${allWorkItemIds.length}`);
    }

    console.log(`[Azure DevOps] Fetched details for ${workItems.length} work items out of ${allWorkItemIds.length}`);
    if (tracker) tracker.workItemDetailsFetched = workItems.length;
    return workItems;
  } catch (error) {
    console.error("[Azure DevOps] Failed to fetch work items:", error);
    throw error;
  }
}

// Read the state-transition actors for a set of bugs from their update history.
// There is no batch "updates" API, so this makes one call per bug (with limited
// concurrency) — it is therefore only run over Bug work items, never the whole
// backlog. Every call is non-fatal: a failure is tracked in `completeness` and
// that bug simply carries no Resolved/Validated credit rather than failing the
// whole import. Returns a map of work item id -> actors.
async function fetchBugStateActors(
  config: AzureDevOpsConfig,
  bugs: AzureDevOpsWorkItem[],
  tracker?: ImportCompleteness
): Promise<Map<number, BugStateActor>> {
  const result = new Map<number, BugStateActor>();
  if (bugs.length === 0) return result;

  if (tracker) tracker.bugHistoryRequested = bugs.length;
  console.log(`[Azure DevOps] Reading state history for ${bugs.length} bugs...`);

  const concurrency = 5;
  for (let i = 0; i < bugs.length; i += concurrency) {
    const slice = bugs.slice(i, i + concurrency);
    const settled = await Promise.all(
      slice.map(async bug => {
        try {
          const data = await fetchAzureDevOps<{ value: AzureDevOpsWorkItemUpdate[] }>(
            config,
            `/wit/workItems/${bug.id}/updates`
          );
          return { id: bug.id, actors: extractBugStateActors(data.value || []) };
        } catch {
          if (tracker) tracker.bugHistoryFailed++;
          return null;
        }
      })
    );
    for (const s of settled) {
      if (s) result.set(s.id, s.actors);
    }
  }

  if (tracker) tracker.bugHistoryFetched = result.size;
  console.log(`[Azure DevOps] Read bug state history for ${result.size}/${bugs.length} bugs`);
  return result;
}

export function aggregateContributorStats(
  commits: AzureDevOpsCommit[],
  pullRequests: AzureDevOpsPullRequest[],
  workItems: AzureDevOpsWorkItem[],
  prMergeStats: { mergeTimeByAuthor: Map<string, number[]> },
  streakData: { streaksByAuthor: Map<string, number> },
  bugActors: Map<number, BugStateActor> = new Map()
): Contributor[] {
  const contributorMap = new Map<string, Contributor>();

  // Track commit hours for favorite hour calculation
  const commitHoursByAuthor = new Map<string, number[]>();

  const norm = (s?: string) => (s ? s.trim().toLowerCase() : undefined);

  function ensure(name: string): Contributor {
    if (!contributorMap.has(name)) {
      contributorMap.set(name, {
        name,
        commits: 0,
        pullRequestsOpened: 0,
        pullRequestsReviewed: 0,
        commentsWritten: 0,
        bugsFixed: 0,
        bugsResolved: 0,
        bugsValidated: 0,
        storyPointsDone: 0,
        linesAdded: 0,
        linesDeleted: 0,
        avgPrMergeTimeHours: 0,
        longestStreak: 0,
        favoriteHour: 0,
      });
      commitHoursByAuthor.set(name, new Array(24).fill(0));
    }
    return contributorMap.get(name)!;
  }

  // Record which identity space a row was seen in (commits = git, PRs/work items = azure).
  function markSource(c: Contributor, s: "git" | "azure") {
    c.source = !c.source ? s : c.source === s ? s : "mixed";
  }

  for (const commit of commits) {
    const name = commit.author?.name?.trim() || "Unknown";
    const c = ensure(name);
    c.commits++;
    if (!c.email && commit.author?.email) c.email = norm(commit.author.email);
    markSource(c, "git");

    // Track commit hour
    const hour = new Date(commit.author.date).getHours();
    commitHoursByAuthor.get(name)![hour]++;
  }

  for (const pr of pullRequests) {
    const name = pr.createdBy?.displayName?.trim() || "Unknown";
    const c = ensure(name);
    c.pullRequestsOpened++;
    if (!c.uniqueName && pr.createdBy?.uniqueName) c.uniqueName = norm(pr.createdBy.uniqueName);
    markSource(c, "azure");

    for (const reviewer of pr.reviewers || []) {
      // Only count reviewers who actually cast a vote (approve/reject/waiting), matching the
      // project-level "reviews" metric. Assigned-but-inactive reviewers are ignored.
      if (reviewer.vote === 0) continue;
      const reviewerName = reviewer.displayName?.trim() || "Unknown";
      const rc = ensure(reviewerName);
      rc.pullRequestsReviewed++;
      if (!rc.uniqueName && reviewer.uniqueName) rc.uniqueName = norm(reviewer.uniqueName);
      markSource(rc, "azure");
    }
  }

  for (const wi of workItems) {
    const at = wi.fields["System.AssignedTo"];
    const assignee = at?.displayName?.trim();
    if (!assignee) continue;

    // Include people who only have work items assigned (no commits/PRs) so the roster is complete.
    const c = ensure(assignee);
    if (!c.uniqueName && at?.uniqueName) c.uniqueName = norm(at.uniqueName);
    markSource(c, "azure");

    if (isBugFixed(wi)) c.bugsFixed++;
    c.storyPointsDone += completedStoryPoints(wi);
  }

  // Bug Slayer / Validation Hero: credited to the ACTUAL person who moved each
  // bug to Resolved / to a validated state (from work item history), not the
  // current assignee. Only bugs whose history was read appear here.
  for (const wi of workItems) {
    if (!isBug(wi)) continue;
    const actors = bugActors.get(wi.id);
    if (!actors) continue;
    if (actors.resolvedBy) {
      const rc = ensure(actors.resolvedBy);
      if (!rc.uniqueName && actors.resolvedByUnique) rc.uniqueName = actors.resolvedByUnique;
      markSource(rc, "azure");
      rc.bugsResolved = (rc.bugsResolved || 0) + 1;
    }
    if (actors.validatedBy) {
      const vc = ensure(actors.validatedBy);
      if (!vc.uniqueName && actors.validatedByUnique) vc.uniqueName = actors.validatedByUnique;
      markSource(vc, "azure");
      vc.bugsValidated = (vc.bugsValidated || 0) + 1;
    }
  }

  // Add PR merge time and streak data
  Array.from(contributorMap.entries()).forEach(([name, contributor]) => {
    // Average PR merge time
    const mergeTimes = prMergeStats.mergeTimeByAuthor.get(name);
    if (mergeTimes && mergeTimes.length > 0) {
      contributor.avgPrMergeTimeHours = Math.round(mergeTimes.reduce((a, b) => a + b, 0) / mergeTimes.length);
    }

    // Longest streak
    contributor.longestStreak = streakData.streaksByAuthor.get(name) || 0;

    // Favorite hour
    const hours = commitHoursByAuthor.get(name);
    if (hours) {
      contributor.favoriteHour = hours.indexOf(Math.max(...hours));
    }
  });

  // Return every contributor (sorted by commits). Champions/Top 5 take their own slices,
  // and the Contributors slide shows the full roster of people who worked on the project.
  return Array.from(contributorMap.values())
    .sort((a, b) => b.commits - a.commits);
}

// Merge a group of raw identities into one canonical person: sum the metrics,
// prefer an Azure identity as the label, and keep the individual identities as
// aliases (with their own commit counts) for the details view.
function mergePeople(members: Contributor[]): Contributor {
  const sum = (k: keyof Contributor) => members.reduce((n, m) => n + ((m[k] as number) || 0), 0);
  const hasAzure = members.some(m => m.source === "azure" || m.source === "mixed");
  const hasGit = members.some(m => m.source === "git" || m.source === "mixed");
  const byCommitsDesc = [...members].sort((a, b) => b.commits - a.commits);
  // Prefer an Azure-backed identity as the canonical label; else the top committer.
  const primary =
    byCommitsDesc.find(m => m.source === "azure" || m.source === "mixed") || byCommitsDesc[0];

  const aliases: ContributorAlias[] = byCommitsDesc.map(m => ({
    name: m.name,
    email: m.email ?? m.uniqueName,
    source: m.source === "git" ? "git" : "azure",
    commits: m.commits,
  }));

  return {
    name: primary.name,
    commits: sum("commits"),
    pullRequestsOpened: sum("pullRequestsOpened"),
    pullRequestsReviewed: sum("pullRequestsReviewed"),
    commentsWritten: sum("commentsWritten"),
    bugsFixed: sum("bugsFixed"),
    bugsResolved: sum("bugsResolved"),
    bugsValidated: sum("bugsValidated"),
    storyPointsDone: sum("storyPointsDone"),
    linesAdded: sum("linesAdded"),
    linesDeleted: sum("linesDeleted"),
    avgPrMergeTimeHours: primary.avgPrMergeTimeHours,
    longestStreak: Math.max(...members.map(m => m.longestStreak || 0)),
    favoriteHour: primary.favoriteHour,
    email: primary.email ?? members.find(m => m.email)?.email,
    uniqueName: primary.uniqueName ?? members.find(m => m.uniqueName)?.uniqueName,
    source: hasAzure && hasGit ? "mixed" : hasAzure ? "azure" : "git",
    isUnmappedGit: !hasAzure,
    aliases: members.length > 1 ? aliases : undefined,
  };
}

// Auto-merge raw per-name contributor rows into canonical people so the same
// human never appears as several rows. Matching rules (safe, non-fuzzy):
//   1. shared email / uniqueName  (a git author email == an Azure UPN)
//   2. identical normalized display name
// User-confirmed manual associations are applied later, client-side, on top.
export function canonicalizeContributors(rows: Contributor[]): Contributor[] {
  const parent = rows.map((_, i) => i);
  const find = (x: number): number => (parent[x] === x ? x : (parent[x] = find(parent[x])));
  const union = (a: number, b: number) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[ra] = rb;
  };

  // Rule 1: link by any shared email-like identifier (email OR uniqueName).
  const byEmail = new Map<string, number>();
  rows.forEach((r, i) => {
    for (const id of [r.email, r.uniqueName]) {
      if (!id) continue;
      if (byEmail.has(id)) union(byEmail.get(id)!, i);
      else byEmail.set(id, i);
    }
  });

  // Rule 2: link by identical normalized display name.
  const byName = new Map<string, number>();
  rows.forEach((r, i) => {
    const key = r.name.trim().toLowerCase();
    if (byName.has(key)) union(byName.get(key)!, i);
    else byName.set(key, i);
  });

  const groups = new Map<number, Contributor[]>();
  rows.forEach((r, i) => {
    const root = find(i);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root)!.push(r);
  });

  return Array.from(groups.values())
    .map(mergePeople)
    .sort((a, b) => b.commits - a.commits);
}

// Modules are derived from work item Area Paths. We can only attribute work items
// (not commits or PRs) to an area path, so we report work items, story points, bugs
// and contributors — the metrics that are actually available at this granularity.
export function aggregateModuleStats(workItems: AzureDevOpsWorkItem[]): Module[] {
  interface ModuleAcc {
    name: string;
    workItems: number;
    storyPointsDone: number;
    bugsFixed: number;
    contributors: Set<string>;
    doneCount: number;
  }

  const moduleMap = new Map<string, ModuleAcc>();

  for (const wi of workItems) {
    const areaPath = wi.fields["System.AreaPath"] || "General";
    const moduleName = areaPath.split("\\").pop() || "General";

    if (!moduleMap.has(moduleName)) {
      moduleMap.set(moduleName, {
        name: moduleName,
        workItems: 0,
        storyPointsDone: 0,
        bugsFixed: 0,
        contributors: new Set(),
        doneCount: 0,
      });
    }

    const acc = moduleMap.get(moduleName)!;
    acc.workItems++;
    acc.storyPointsDone += completedStoryPoints(wi);

    if (isDoneState(wi.fields["System.State"])) {
      acc.doneCount++;
    }
    if (isBugFixed(wi)) {
      acc.bugsFixed++;
    }
    const assignee = wi.fields["System.AssignedTo"]?.displayName;
    if (assignee) acc.contributors.add(assignee);
  }

  return Array.from(moduleMap.values())
    .sort((a, b) => b.workItems - a.workItems)
    .slice(0, 6)
    .map((acc): Module => {
      const completionRate = acc.workItems > 0 ? acc.doneCount / acc.workItems : 0;
      const status = completionRate >= 0.99 ? "Complete" : completionRate > 0 ? "In Progress" : "Planned";
      return {
        name: acc.name,
        // commits/pullRequests cannot be attributed to an area path; report 0 (hidden in the UI).
        commits: 0,
        pullRequests: 0,
        storyPointsDone: acc.storyPointsDone,
        status,
        bugsFixed: acc.bugsFixed,
        contributors: acc.contributors.size,
        workItems: acc.workItems,
      };
    });
}

export function calculateTop5(
  contributors: Contributor[],
  commits: AzureDevOpsCommit[],
  streakData: { streaksByAuthor: Map<string, number> }
): Top5 {
  const commitsByDate = new Map<string, number>();
  for (const commit of commits) {
    const date = commit.author.date.split("T")[0];
    commitsByDate.set(date, (commitsByDate.get(date) || 0) + 1);
  }

  const busiestDays = Array.from(commitsByDate.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([date, count]) => ({ date, commits: count }));

  // Create sorted copies to avoid mutating original array
  const sortedByCommits = [...contributors].sort((a, b) => b.commits - a.commits);
  const sortedByPRsOpened = [...contributors].sort((a, b) => b.pullRequestsOpened - a.pullRequestsOpened);
  const sortedByPRsReviewed = [...contributors].sort((a, b) => b.pullRequestsReviewed - a.pullRequestsReviewed);
  const sortedByComments = [...contributors].sort((a, b) => b.commentsWritten - a.commentsWritten);
  const sortedByStreaks = [...contributors].sort((a, b) => (b.longestStreak || 0) - (a.longestStreak || 0));

  return {
    mostCommits: sortedByCommits
      .slice(0, 5)
      .map(c => ({ name: c.name, commits: c.commits })),
    mostPullRequestsOpened: sortedByPRsOpened
      .slice(0, 5)
      .map(c => ({ name: c.name, pullRequestsOpened: c.pullRequestsOpened })),
    mostPullRequestsReviewed: sortedByPRsReviewed
      .slice(0, 5)
      .map(c => ({ name: c.name, pullRequestsReviewed: c.pullRequestsReviewed })),
    mostCommentsWritten: sortedByComments
      .slice(0, 5)
      .map(c => ({ name: c.name, commentsWritten: c.commentsWritten })),
    busiestDaysByCommits: busiestDays,
    longestStreaks: sortedByStreaks
      .filter(c => (c.longestStreak || 0) > 0)
      .slice(0, 5)
      .map(c => ({ name: c.name, commits: c.longestStreak || 0 })),
  };
}

function generateHighlights(
  commits: AzureDevOpsCommit[],
  pullRequests: AzureDevOpsPullRequest[],
  workItems: AzureDevOpsWorkItem[],
  activityPattern: ActivityPattern
): string[] {
  const highlights: string[] = [];

  if (commits.length > 0) {
    highlights.push(`${commits.length.toLocaleString()} commits pushed`);
  }

  if (pullRequests.length > 0) {
    const mergedPRs = pullRequests.filter(pr => pr.status === "completed").length;
    highlights.push(`${mergedPRs.toLocaleString()} pull requests merged`);
  }

  // Count work items by type
  const workItemsByType = new Map<string, number>();
  for (const wi of workItems) {
    const type = wi.fields["System.WorkItemType"] || "Unknown";
    workItemsByType.set(type, (workItemsByType.get(type) || 0) + 1);
  }

  // Add type-specific highlights
  const bugs = workItemsByType.get("Bug") || 0;
  const bugsFixed = workItems.filter(isBugFixed).length;
  if (bugsFixed > 0) {
    highlights.push(`${bugsFixed} bugs squashed out of ${bugs} total`);
  } else if (bugs > 0) {
    highlights.push(`${bugs} bugs tracked`);
  }

  // Check for other common work item types
  const features = workItemsByType.get("Feature") || workItemsByType.get("User Story") || 0;
  if (features > 0) {
    highlights.push(`${features} features delivered`);
  }

  const testCases = workItemsByType.get("Test Case") || workItemsByType.get("Test Plan") || 0;
  if (testCases > 0) {
    highlights.push(`${testCases} test cases created`);
  }

  const srds = workItemsByType.get("Requirement") || workItemsByType.get("SRD") || 0;
  if (srds > 0) {
    highlights.push(`${srds} requirements documented`);
  }

  const totalStoryPoints = workItems.reduce((acc, wi) => acc + completedStoryPoints(wi), 0);
  if (totalStoryPoints > 0) {
    highlights.push(`${totalStoryPoints} story points delivered`);
  }

  const uniqueContributors = new Set(commits.map(c => c.author.name)).size;
  if (uniqueContributors > 0) {
    highlights.push(`${uniqueContributors} team members contributed`);
  }

  // Enhanced: Activity pattern highlight
  if (activityPattern.peakProductivityTime) {
    highlights.push(`Peak productivity: ${activityPattern.peakProductivityTime} (${activityPattern.busiestHour}:00)`);
  }

  return highlights.slice(0, 10);
}

function generateFunFacts(
  commits: AzureDevOpsCommit[],
  pullRequests: AzureDevOpsPullRequest[],
  workItems: AzureDevOpsWorkItem[],
  activityPattern: ActivityPattern,
  prMergeStats: { avgMergeTimeHours: number; fastestMergeTimeHours: number },
  streakData: { longestStreak: number }
): string[] {
  const funFacts: string[] = [];

  // Fun fact: busiest day
  if (activityPattern.busiestDay) {
    funFacts.push(`${activityPattern.busiestDay} was the team's favorite day to code`);
  }

  // Fun fact: night owl or early bird
  if (activityPattern.busiestHour >= 22 || activityPattern.busiestHour <= 5) {
    funFacts.push(`🦉 Night owl detected! Most commits at ${activityPattern.busiestHour}:00`);
  } else if (activityPattern.busiestHour >= 5 && activityPattern.busiestHour <= 8) {
    funFacts.push(`🐦 Early bird! Most commits at ${activityPattern.busiestHour}:00`);
  }

  // Fun fact: PR merge speed
  if (prMergeStats.avgMergeTimeHours > 0) {
    if (prMergeStats.avgMergeTimeHours < 24) {
      funFacts.push(`⚡ Lightning fast! Average PR merged in ${Math.round(prMergeStats.avgMergeTimeHours)} hours`);
    } else {
      const days = Math.round(prMergeStats.avgMergeTimeHours / 24);
      funFacts.push(`📋 PRs took ${days} day${days > 1 ? 's' : ''} on average to merge`);
    }
  }

  // Fun fact: fastest PR
  if (prMergeStats.fastestMergeTimeHours > 0 && prMergeStats.fastestMergeTimeHours < 1) {
    funFacts.push(`🚀 Fastest PR merged in just ${Math.round(prMergeStats.fastestMergeTimeHours * 60)} minutes!`);
  } else if (prMergeStats.fastestMergeTimeHours > 0) {
    funFacts.push(`🚀 Fastest PR merged in ${Math.round(prMergeStats.fastestMergeTimeHours * 10) / 10} hours`);
  }

  // Fun fact: commit streak
  if (streakData.longestStreak >= 7) {
    funFacts.push(`🔥 ${streakData.longestStreak}-day commit streak! Dedication at its finest`);
  } else if (streakData.longestStreak >= 3) {
    funFacts.push(`📅 Longest commit streak: ${streakData.longestStreak} consecutive days`);
  }

  // Fun fact: commits per day average
  const commitDates = new Set(commits.map(c => c.author.date.split("T")[0]));
  const activeDays = commitDates.size;
  if (activeDays > 0) {
    const avgPerDay = Math.round((commits.length / activeDays) * 10) / 10;
    funFacts.push(`📊 ${avgPerDay} commits per active day on average`);
  }

  // Fun fact: weekend warrior or weekday warrior
  const weekendCommits = activityPattern.dailyDistribution[0] + activityPattern.dailyDistribution[6];
  const weekdayCommits = activityPattern.dailyDistribution.slice(1, 6).reduce((a, b) => a + b, 0);
  if (weekendCommits > weekdayCommits * 0.5) {
    funFacts.push(`🏆 Weekend warrior! ${weekendCommits} weekend commits`);
  }

  // Fun fact: PR approval rate
  const approvedPRs = pullRequests.filter(pr => pr.status === "completed").length;
  const totalPRs = pullRequests.length;
  if (totalPRs > 0) {
    const approvalRate = Math.round((approvedPRs / totalPRs) * 100);
    if (approvalRate >= 90) {
      funFacts.push(`✅ ${approvalRate}% PR approval rate - quality code!`);
    }
  }

  // Fun fact: work item velocity
  const doneWorkItems = workItems.filter(wi => isDoneState(wi.fields["System.State"])).length;
  if (doneWorkItems > 100) {
    funFacts.push(`💪 ${doneWorkItems} work items completed - unstoppable!`);
  } else if (doneWorkItems > 50) {
    funFacts.push(`📈 ${doneWorkItems} work items shipped`);
  }

  // Fun fact: most common commit hour personality
  const hourPersonality = getHourPersonality(activityPattern.busiestHour);
  if (hourPersonality) {
    funFacts.push(hourPersonality);
  }

  return funFacts.slice(0, 8);
}

function getHourPersonality(hour: number): string | null {
  if (hour >= 9 && hour <= 11) return "☕ Morning coffee coder - most productive 9-11 AM";
  if (hour >= 14 && hour <= 16) return "🥪 Post-lunch productivity - most commits 2-4 PM";
  if (hour >= 17 && hour <= 19) return "🌅 Evening enthusiast - peak activity 5-7 PM";
  if (hour >= 20 && hour <= 23) return "🌙 Moonlight developer - coding into the night";
  if (hour >= 0 && hour <= 4) return "🦇 Vampire coder - commits in the dead of night";
  return null;
}

function generateMilestones(
  commits: AzureDevOpsCommit[],
  pullRequests: AzureDevOpsPullRequest[],
  workItems: AzureDevOpsWorkItem[],
  dateFrom?: string,
  dateTo?: string
): Milestone[] {
  const milestones: Milestone[] = [];

  const sortedCommits = commits.length > 0
    ? [...commits].sort((a, b) => new Date(a.author.date).getTime() - new Date(b.author.date).getTime())
    : [];

  if (sortedCommits.length > 0) {
    const firstCommit = sortedCommits[0];
    milestones.push({
      date: firstCommit.author.date.split("T")[0],
      title: "First Commit",
      description: firstCommit.comment?.split("\n")[0]?.substring(0, 60) || "Project kicked off",
      icon: "rocket",
    });

    // Busiest month by commit volume — a real, data-driven milestone.
    const commitsByMonth = new Map<string, number>();
    for (const c of sortedCommits) {
      const month = c.author.date.substring(0, 7); // YYYY-MM
      commitsByMonth.set(month, (commitsByMonth.get(month) || 0) + 1);
    }
    const busiest = Array.from(commitsByMonth.entries()).sort((a, b) => b[1] - a[1])[0];
    if (busiest) {
      const monthLabel = new Date(`${busiest[0]}-01T00:00:00`).toLocaleDateString("en-US", { month: "long", year: "numeric" });
      milestones.push({
        date: `${busiest[0]}-15`,
        title: "Busiest Month",
        description: `${monthLabel} — ${busiest[1].toLocaleString()} commits`,
        icon: "flame",
      });
    }
  }

  // First and most recent merged PR.
  const mergedPrs = pullRequests
    .filter(pr => pr.status === "completed" && pr.closedDate)
    .sort((a, b) => new Date(a.closedDate!).getTime() - new Date(b.closedDate!).getTime());
  if (mergedPrs.length > 0) {
    milestones.push({
      date: mergedPrs[0].closedDate!.split("T")[0],
      title: "First PR Merged",
      description: mergedPrs[0].title?.substring(0, 60) || "First contribution merged",
      icon: "flag",
    });
  }

  if (sortedCommits.length > 0) {
    const lastCommit = sortedCommits[sortedCommits.length - 1];
    milestones.push({
      date: lastCommit.author.date.split("T")[0],
      title: "Latest Commit",
      description: lastCommit.comment?.split("\n")[0]?.substring(0, 60) || "The journey continues",
      icon: "lock",
    });
  }

  // De-duplicate by date+title and order chronologically.
  const seen = new Set<string>();
  return milestones
    .filter(m => {
      const key = `${m.date}|${m.title}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
}

export function validateAzureDevOpsConfig(config: Partial<AzureDevOpsConfig>): string[] {
  const errors: string[] = [];

  if (!config.organization?.trim()) {
    errors.push("Organization is required");
  }

  if (!config.project?.trim()) {
    errors.push("Project name is required");
  }

  if (!config.personalAccessToken?.trim()) {
    errors.push("Personal Access Token is required");
  }

  return errors;
}

export async function testAzureDevOpsConnection(config: AzureDevOpsConfig): Promise<{ success: boolean; message: string; details?: any }> {
  try {
    console.log(`[Azure DevOps] Testing connection to ${config.organization}/${config.project}...`);
    console.log(`[Azure DevOps] Base URL: ${config.baseUrl || 'Azure DevOps cloud'}`);
    
    // Test by fetching repositories (more reliable than project endpoint for on-premises)
    const reposResponse = await fetchAzureDevOps<{
      value: Array<{ id: string; name: string; isDisabled?: boolean }>;
    }>(config, "/git/repositories");
    // Disabled repositories can't be read, so don't offer them for selection.
    const { active: repos, disabled } = splitDisabledRepositories(reposResponse.value || []);

    console.log(`[Azure DevOps] Found ${repos.length} repositories (${disabled.length} disabled, skipped)`);

    // If we have repos, connection is successful
    if (repos.length === 0) {
      return {
        success: true,
        message: `Connected to ${config.project}, but no repositories found`,
        details: {
          projectName: config.project,
          repositoryCount: 0,
          repositories: [],
        }
      };
    }
    
    return {
      success: true,
      message: `Successfully connected to ${config.project}`,
      details: {
        projectName: config.project,
        repositoryCount: repos.length,
        repositories: repos.map(r => r.name),
        disabledRepositories: disabled,
      }
    };
  } catch (error) {
    console.error("[Azure DevOps] Connection test failed:", error);
    return {
      success: false,
      message: error instanceof Error ? error.message : "Connection test failed",
    };
  }
}
