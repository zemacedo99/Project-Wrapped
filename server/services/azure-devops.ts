import https from "https";
import type { ProjectWrappedData, Contributor, Module, Milestone, Top5, RepositoryStats, ActivityPattern } from "@shared/schema";

interface AzureDevOpsConfig {
  organization: string;
  project: string;
  personalAccessToken: string;
  baseUrl?: string; // Optional: for on-premises Azure DevOps Server (defaults to cloud)
  repositoryId?: string;
  dateFrom?: string;
  dateTo?: string;
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
  };
  closedDate?: string;
  creationDate: string;
  reviewers?: Array<{
    displayName: string;
    vote: number;
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
    };
    "Microsoft.VSTS.Scheduling.StoryPoints"?: number;
    "System.CreatedDate": string;
    "System.AreaPath"?: string;
  };
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

export async function fetchAzureDevOpsData(config: AzureDevOpsConfig): Promise<ProjectWrappedData> {
  const dateFrom = config.dateFrom;
  const dateTo = config.dateTo;

  console.log(`[Azure DevOps] Fetching data for ${config.organization}/${config.project}`);
  if (dateFrom && dateTo) {
    console.log(`[Azure DevOps] Date range: ${dateFrom} to ${dateTo}`);
  } else {
    console.log(`[Azure DevOps] Fetching all commits (no date filter)`);
  }

  // Fetch repositories first to get repo-level stats
  const repositories = await fetchRepositories(config);

  const [commits, pullRequests, workItems] = await Promise.all([
    fetchCommits(config, repositories, dateFrom, dateTo),
    fetchPullRequests(config, repositories, dateFrom, dateTo),
    fetchWorkItems(config, dateFrom, dateTo),
  ]);

  console.log(`[Azure DevOps] Fetched: ${commits.length} commits, ${pullRequests.length} PRs, ${workItems.length} work items`);

  // Calculate enhanced stats
  const prMergeStats = calculatePrMergeStats(pullRequests);
  const activityPattern = calculateActivityPattern(commits);
  const streakData = calculateStreaks(commits);
  const repoStats = aggregateRepositoryStats(commits, pullRequests, repositories);
  const workItemBreakdown = aggregateWorkItemTypes(workItems);

  const contributorStats = aggregateContributorStats(commits, pullRequests, workItems, prMergeStats, streakData);
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
    sprintsCompleted: dateFrom && dateTo ? Math.floor((new Date(dateTo).getTime() - new Date(dateFrom).getTime()) / (14 * 24 * 60 * 60 * 1000)) : 0,
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
      `Bugs fixed: work items of type "Bug" in a completed state (${DONE_STATES_LABEL}).`,
      `Story points: sum of Story Points on work items in a completed state (${DONE_STATES_LABEL}).`,
      "Code reviews: reviewers who cast a vote (approved, approved w/ suggestions, waiting or rejected) on a PR.",
      "PR merge rate: completed PRs ÷ all PRs in range.",
      "Longest streak: most consecutive calendar days with at least one commit, per author.",
    ],
    notes: [
      "PR discussion comments and lines-added/deleted are not collected — scanning every PR thread at project scale is too slow, so those metrics are intentionally omitted rather than shown partially.",
      "Contributors from commits are identified by git author name; contributors from PRs and work items by their Azure DevOps display name. If a person's git name differs from their display name they may appear more than once.",
      "Activity hours (busiest hour, night owl / early bird) are computed in the server's local timezone.",
      "Sprints completed is estimated from the date range assuming a two-week cadence, not read from Azure DevOps iterations.",
    ],
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
async function fetchRepositories(config: AzureDevOpsConfig): Promise<Array<{ id: string; name: string }>> {
  try {
    const reposResponse = await fetchAzureDevOps<{ value: Array<{ id: string; name: string }> }>(
      config,
      "/git/repositories"
    );
    return reposResponse.value || [];
  } catch (error) {
    console.warn("[Azure DevOps] Failed to fetch repositories:", error);
    return [];
  }
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
  dateTo?: string
): Promise<AzureDevOpsCommit[]> {
  try {
    console.log(`[Azure DevOps] Fetching commits from ${repositories.length} repositories...`);
    const allCommits: AzureDevOpsCommit[] = [];
    const pageSize = 1000;

    for (const repo of repositories) {
      try {
        let skip = 0;
        let repoCommitCount = 0;

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
  dateTo?: string
): Promise<AzureDevOpsPullRequest[]> {
  try {
    console.log(`[Azure DevOps] Fetching pull requests from ${repositories.length} repositories...`);
    const allPRs: AzureDevOpsPullRequest[] = [];
    const pageSize = 1000;

    for (const repo of repositories) {
      try {
        let skip = 0;
        let repoPrCount = 0;

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
  dateTo?: string
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
    return workItems;
  } catch (error) {
    console.error("[Azure DevOps] Failed to fetch work items:", error);
    throw error;
  }
}

export function aggregateContributorStats(
  commits: AzureDevOpsCommit[],
  pullRequests: AzureDevOpsPullRequest[],
  workItems: AzureDevOpsWorkItem[],
  prMergeStats: { mergeTimeByAuthor: Map<string, number[]> },
  streakData: { streaksByAuthor: Map<string, number> }
): Contributor[] {
  const contributorMap = new Map<string, Contributor>();

  // Track commit hours for favorite hour calculation
  const commitHoursByAuthor = new Map<string, number[]>();

  for (const commit of commits) {
    const name = commit.author?.name?.trim() || "Unknown";
    if (!contributorMap.has(name)) {
      contributorMap.set(name, {
        name,
        commits: 0,
        pullRequestsOpened: 0,
        pullRequestsReviewed: 0,
        commentsWritten: 0,
        bugsFixed: 0,
        storyPointsDone: 0,
        linesAdded: 0,
        linesDeleted: 0,
        avgPrMergeTimeHours: 0,
        longestStreak: 0,
        favoriteHour: 0,
      });
      commitHoursByAuthor.set(name, new Array(24).fill(0));
    }
    contributorMap.get(name)!.commits++;
    
    // Track commit hour
    const hour = new Date(commit.author.date).getHours();
    commitHoursByAuthor.get(name)![hour]++;
  }

  for (const pr of pullRequests) {
    const name = pr.createdBy?.displayName?.trim() || "Unknown";
    if (!contributorMap.has(name)) {
      contributorMap.set(name, {
        name,
        commits: 0,
        pullRequestsOpened: 0,
        pullRequestsReviewed: 0,
        commentsWritten: 0,
        bugsFixed: 0,
        storyPointsDone: 0,
        linesAdded: 0,
        linesDeleted: 0,
        avgPrMergeTimeHours: 0,
        longestStreak: 0,
        favoriteHour: 0,
      });
      commitHoursByAuthor.set(name, new Array(24).fill(0));
    }
    contributorMap.get(name)!.pullRequestsOpened++;

    for (const reviewer of pr.reviewers || []) {
      // Only count reviewers who actually cast a vote (approve/reject/waiting), matching the
      // project-level "reviews" metric. Assigned-but-inactive reviewers are ignored.
      if (reviewer.vote === 0) continue;
      const reviewerName = reviewer.displayName?.trim() || "Unknown";
      if (!contributorMap.has(reviewerName)) {
        contributorMap.set(reviewerName, {
          name: reviewerName,
          commits: 0,
          pullRequestsOpened: 0,
          pullRequestsReviewed: 0,
          commentsWritten: 0,
          bugsFixed: 0,
          storyPointsDone: 0,
          linesAdded: 0,
          linesDeleted: 0,
          avgPrMergeTimeHours: 0,
          longestStreak: 0,
          favoriteHour: 0,
        });
        commitHoursByAuthor.set(reviewerName, new Array(24).fill(0));
      }
      contributorMap.get(reviewerName)!.pullRequestsReviewed++;
    }
  }

  for (const wi of workItems) {
    const assignee = wi.fields["System.AssignedTo"]?.displayName?.trim();
    if (!assignee) continue;

    // Include people who only have work items assigned (no commits/PRs) so the roster is complete.
    if (!contributorMap.has(assignee)) {
      contributorMap.set(assignee, {
        name: assignee,
        commits: 0,
        pullRequestsOpened: 0,
        pullRequestsReviewed: 0,
        commentsWritten: 0,
        bugsFixed: 0,
        storyPointsDone: 0,
        linesAdded: 0,
        linesDeleted: 0,
        avgPrMergeTimeHours: 0,
        longestStreak: 0,
        favoriteHour: 0,
      });
      commitHoursByAuthor.set(assignee, new Array(24).fill(0));
    }

    if (isBugFixed(wi)) {
      contributorMap.get(assignee)!.bugsFixed++;
    }
    contributorMap.get(assignee)!.storyPointsDone += completedStoryPoints(wi);
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
    const reposResponse = await fetchAzureDevOps<{ value: Array<{ id: string; name: string }> }>(
      config,
      "/git/repositories"
    );
    
    console.log(`[Azure DevOps] Found ${reposResponse.value.length} repositories`);
    
    // If we have repos, connection is successful
    if (reposResponse.value.length === 0) {
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
        repositoryCount: reposResponse.value.length,
        repositories: reposResponse.value.map(r => r.name),
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
