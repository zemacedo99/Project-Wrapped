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

interface AzureDevOpsCommit {
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
}

interface AzureDevOpsPullRequest {
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

interface AzureDevOpsWorkItem {
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
  
  const [commits, pullRequests, workItems, prComments, fileChanges] = await Promise.all([
    fetchCommits(config, dateFrom, dateTo),
    fetchPullRequests(config),
    fetchWorkItems(config, dateFrom, dateTo),
    fetchPullRequestComments(config),
    fetchCommitChanges(config, dateFrom, dateTo),
  ]);

  console.log(`[Azure DevOps] Fetched: ${commits.length} commits, ${pullRequests.length} PRs, ${workItems.length} work items, ${prComments} PR comments`);

  // Calculate enhanced stats
  const prMergeStats = calculatePrMergeStats(pullRequests);
  const activityPattern = calculateActivityPattern(commits);
  const streakData = calculateStreaks(commits);
  const codeChanges = aggregateCodeChanges(fileChanges);
  const repoStats = aggregateRepositoryStats(commits, pullRequests, repositories);
  const workItemBreakdown = aggregateWorkItemTypes(workItems);

  const contributorStats = aggregateContributorStats(commits, pullRequests, workItems, prMergeStats, streakData);
  const moduleStats = aggregateModuleStats(workItems);
  const top5 = calculateTop5(contributorStats, commits, streakData);
  const highlights = generateHighlights(commits, pullRequests, workItems, prComments, codeChanges, activityPattern);
  const funFacts = generateFunFacts(commits, pullRequests, workItems, activityPattern, prMergeStats, streakData);
  const milestones = generateMilestones(commits, pullRequests, workItems, dateFrom, dateTo);

  const mergedPrs = pullRequests.filter(pr => pr.status === "completed").length;
  const totalStats = {
    totalCommits: commits.length,
    totalPullRequests: pullRequests.length,
    totalReviews: pullRequests.reduce((acc, pr) => acc + (pr.reviewers?.length || 0), 0),
    totalComments: prComments,
    totalBugsFixed: workItems.filter(wi => wi.fields["System.WorkItemType"] === "Bug" && wi.fields["System.State"] === "Done").length,
    totalStoryPointsDone: workItems.reduce((acc, wi) => acc + (wi.fields["Microsoft.VSTS.Scheduling.StoryPoints"] || 0), 0),
    sprintsCompleted: dateFrom && dateTo ? Math.floor((new Date(dateTo).getTime() - new Date(dateFrom).getTime()) / (14 * 24 * 60 * 60 * 1000)) : 0,
    // Enhanced stats
    totalLinesAdded: codeChanges.linesAdded,
    totalLinesDeleted: codeChanges.linesDeleted,
    totalFilesChanged: codeChanges.filesChanged,
    totalRepositories: repositories.length,
    avgPrMergeTimeHours: prMergeStats.avgMergeTimeHours,
    fastestPrMergeTimeHours: prMergeStats.fastestMergeTimeHours,
    longestStreak: streakData.longestStreak,
    totalWorkItems: workItems.length,
    prMergeRate: pullRequests.length > 0 ? Math.round((mergedPrs / pullRequests.length) * 100) : 0,
  };

  console.log(`[Azure DevOps] Aggregated ${contributorStats.length} contributors, ${moduleStats.length} modules`);

  return {
    projectName: config.project,
    version: "1.0",
    dateRange: {
      start: dateFrom || new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString().split("T")[0],
      end: dateTo || new Date().toISOString().split("T")[0],
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
function calculatePrMergeStats(pullRequests: AzureDevOpsPullRequest[]): { 
  avgMergeTimeHours: number; 
  fastestMergeTimeHours: number;
  mergeTimeByAuthor: Map<string, number[]>;
} {
  const mergeTimeByAuthor = new Map<string, number[]>();
  const mergeTimes: number[] = [];

  for (const pr of pullRequests) {
    if (pr.status === "completed" && pr.closedDate && pr.creationDate) {
      const created = new Date(pr.creationDate).getTime();
      const closed = new Date(pr.closedDate).getTime();
      const hoursToMerge = (closed - created) / (1000 * 60 * 60);
      
      if (hoursToMerge > 0 && hoursToMerge < 8760) { // Less than 1 year
        mergeTimes.push(hoursToMerge);
        
        const author = pr.createdBy.displayName;
        if (!mergeTimeByAuthor.has(author)) {
          mergeTimeByAuthor.set(author, []);
        }
        mergeTimeByAuthor.get(author)!.push(hoursToMerge);
      }
    }
  }

  return {
    avgMergeTimeHours: mergeTimes.length > 0 ? Math.round(mergeTimes.reduce((a, b) => a + b, 0) / mergeTimes.length) : 0,
    fastestMergeTimeHours: mergeTimes.length > 0 ? Math.round(Math.min(...mergeTimes) * 10) / 10 : 0,
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
function calculateStreaks(commits: AzureDevOpsCommit[]): {
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

// Aggregate code changes from file changes
function aggregateCodeChanges(fileChanges: any[]): {
  linesAdded: number;
  linesDeleted: number;
  filesChanged: number;
} {
  let linesAdded = 0;
  let linesDeleted = 0;
  const filesChanged = new Set<string>();

  for (const change of fileChanges) {
    if (change.item?.path) {
      filesChanged.add(change.item.path);
    }
    // Azure DevOps change types: add, edit, delete
    if (change.changeType === "add" || change.changeType === "edit") {
      linesAdded += change.item?.contentLength || 0;
    }
  }

  return {
    linesAdded,
    linesDeleted,
    filesChanged: filesChanged.size,
  };
}

// Aggregate repository-level stats
function aggregateRepositoryStats(
  commits: AzureDevOpsCommit[],
  pullRequests: AzureDevOpsPullRequest[],
  repositories: Array<{ id: string; name: string }>
): RepositoryStats[] {
  const repoStats = new Map<string, RepositoryStats>();

  // Initialize from repositories list
  for (const repo of repositories) {
    repoStats.set(repo.name, {
      name: repo.name,
      commits: 0,
      pullRequests: 0,
      contributors: 0,
    });
  }

  // Count commits per repo (we need to track this during fetch)
  const contributorsByRepo = new Map<string, Set<string>>();

  for (const commit of commits) {
    // Track unique contributors
    const author = commit.author.name;
    Array.from(repoStats.keys()).forEach(repoName => {
      if (!contributorsByRepo.has(repoName)) {
        contributorsByRepo.set(repoName, new Set());
      }
    });
  }

  // Update contributor counts
  Array.from(contributorsByRepo.entries()).forEach(([repoName, contributors]) => {
    const stats = repoStats.get(repoName);
    if (stats) {
      stats.contributors = contributors.size;
    }
  });

  return Array.from(repoStats.values())
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
  dateFrom?: string,
  dateTo?: string
): Promise<AzureDevOpsCommit[]> {
  try {
    console.log(`[Azure DevOps] Fetching repositories...`);
    const reposResponse = await fetchAzureDevOps<{ value: Array<{ id: string; name: string }> }>(
      config,
      "/git/repositories"
    );

    console.log(`[Azure DevOps] Found ${reposResponse.value.length} repositories`);
    const allCommits: AzureDevOpsCommit[] = [];

    // Fetch from all repositories (up to 10)
    const reposToFetch = reposResponse.value.slice(0, 10);
    
    for (const repo of reposToFetch) {
      try {
        console.log(`[Azure DevOps] Fetching commits from repository: ${repo.name}`);
        // Build query string - only add date filters if provided
        let queryString = "$top=1000";
        if (dateFrom) queryString += `&searchCriteria.fromDate=${dateFrom}`;
        if (dateTo) queryString += `&searchCriteria.toDate=${dateTo}`;
        
        const commitsResponse = await fetchAzureDevOps<{ value: AzureDevOpsCommit[] }>(
          config,
          `/git/repositories/${repo.id}/commits?${queryString}`
        );
        console.log(`[Azure DevOps] Found ${commitsResponse.value.length} commits in ${repo.name}`);
        allCommits.push(...commitsResponse.value);
      } catch (error) {
        console.warn(`[Azure DevOps] Failed to fetch commits for repo ${repo.name}:`, error);
      }
    }

    return allCommits;
  } catch (error) {
    console.error("[Azure DevOps] Failed to fetch commits:", error);
    throw error;
  }
}

async function fetchPullRequests(config: AzureDevOpsConfig): Promise<AzureDevOpsPullRequest[]> {
  try {
    console.log(`[Azure DevOps] Fetching repositories for PRs...`);
    const reposResponse = await fetchAzureDevOps<{ value: Array<{ id: string; name: string }> }>(
      config,
      "/git/repositories"
    );

    const allPRs: AzureDevOpsPullRequest[] = [];
    const reposToFetch = reposResponse.value.slice(0, 10);

    for (const repo of reposToFetch) {
      try {
        console.log(`[Azure DevOps] Fetching PRs from repository: ${repo.name}`);
        const prsResponse = await fetchAzureDevOps<{ value: AzureDevOpsPullRequest[] }>(
          config,
          `/git/repositories/${repo.id}/pullrequests?searchCriteria.status=all&$top=500`
        );
        console.log(`[Azure DevOps] Found ${prsResponse.value.length} PRs in ${repo.name}`);
        allPRs.push(...prsResponse.value);
      } catch (error) {
        console.warn(`[Azure DevOps] Failed to fetch PRs for repo ${repo.name}:`, error);
      }
    }

    return allPRs;
  } catch (error) {
    console.error("[Azure DevOps] Failed to fetch pull requests:", error);
    throw error;
  }
}

async function fetchPullRequestComments(config: AzureDevOpsConfig): Promise<number> {
  try {
    console.log(`[Azure DevOps] Fetching PR comments...`);
    const reposResponse = await fetchAzureDevOps<{ value: Array<{ id: string; name: string }> }>(
      config,
      "/git/repositories"
    );

    let totalComments = 0;
    const reposToFetch = reposResponse.value.slice(0, 10);

    for (const repo of reposToFetch) {
      try {
        const prsResponse = await fetchAzureDevOps<{ value: AzureDevOpsPullRequest[] }>(
          config,
          `/git/repositories/${repo.id}/pullrequests?searchCriteria.status=all&$top=500`
        );

        for (const pr of prsResponse.value || []) {
          try {
            const threadsResponse = await fetchAzureDevOps<{ value: Array<{ comments: Array<any> }> }>(
              config,
              `/git/repositories/${repo.id}/pullrequests/${pr.pullRequestId}/threads`
            );
            
            for (const thread of threadsResponse.value || []) {
              totalComments += thread.comments?.length || 0;
            }
          } catch (error) {
            // Continue if threads fail for a specific PR
          }
        }
      } catch (error) {
        console.warn(`[Azure DevOps] Failed to fetch PR comments for repo ${repo.name}:`, error);
      }
    }

    console.log(`[Azure DevOps] Found ${totalComments} PR comments`);
    return totalComments;
  } catch (error) {
    console.warn("[Azure DevOps] Failed to fetch PR comments:", error);
    return 0; // Return 0 if this fails, don't break the whole process
  }
}

async function fetchCommitChanges(
  config: AzureDevOpsConfig,
  dateFrom?: string,
  dateTo?: string
): Promise<any[]> {
  try {
    console.log(`[Azure DevOps] Fetching commit file changes...`);
    const reposResponse = await fetchAzureDevOps<{ value: Array<{ id: string; name: string }> }>(
      config,
      "/git/repositories"
    );

    const changes: any[] = [];
    const reposToFetch = reposResponse.value.slice(0, 5); // Limit to 5 repos to avoid too many API calls

    for (const repo of reposToFetch) {
      try {
        let queryString = "$top=100";
        if (dateFrom) queryString += `&searchCriteria.fromDate=${dateFrom}`;
        if (dateTo) queryString += `&searchCriteria.toDate=${dateTo}`;

        const commitsResponse = await fetchAzureDevOps<{ value: AzureDevOpsCommit[] }>(
          config,
          `/git/repositories/${repo.id}/commits?${queryString}`
        );

        // For each commit, fetch its changes
        for (const commit of commitsResponse.value || []) {
          try {
            const changesResponse = await fetchAzureDevOps<{ value: any[] }>(
              config,
              `/git/repositories/${repo.id}/commits/${commit.commitId}/changes`
            );
            changes.push(...(changesResponse.value || []));
          } catch (error) {
            // Continue if changes fail for a specific commit
          }
        }
      } catch (error) {
        console.warn(`[Azure DevOps] Failed to fetch changes for repo ${repo.name}:`, error);
      }
    }

    console.log(`[Azure DevOps] Found ${changes.length} file changes`);
    return changes;
  } catch (error) {
    console.warn("[Azure DevOps] Failed to fetch commit changes:", error);
    return []; // Return empty array if this fails
  }
}

async function fetchWorkItems(
  config: AzureDevOpsConfig,
  dateFrom?: string,
  dateTo?: string
): Promise<AzureDevOpsWorkItem[]> {
  try {
    console.log(`[Azure DevOps] Querying work items...`);
    // Build WHERE clause - only add date filters if provided
    let whereClause = `[System.TeamProject] = '${config.project}'`;
    if (dateFrom && dateTo) {
      whereClause += ` AND [System.CreatedDate] >= '${dateFrom}' AND [System.CreatedDate] <= '${dateTo}'`;
    }
    
    const wiqlQuery = {
      query: `SELECT [System.Id] FROM workitems WHERE ${whereClause} ORDER BY [System.ChangedDate] DESC`,
    };

    // Use the main API helper with POST method for WIQL query
    const queryData = await fetchAzureDevOps<{ workItems: Array<{ id: number }> }>(
      config,
      `/wit/wiql`,
      "7.0",
      "POST",
      JSON.stringify(wiqlQuery)
    );

    // Get ALL work item IDs from the query (WIQL returns all results, but we'll process in batches)
    const allWorkItemIds = queryData.workItems?.map((wi: { id: number }) => wi.id) || [];

    console.log(`[Azure DevOps] Found ${allWorkItemIds.length} work items total`);

    if (allWorkItemIds.length === 0) {
      return [];
    }

    // Process in batches of 200 (Azure DevOps API limit)
    const batchSize = 200;
    const workItems: AzureDevOpsWorkItem[] = [];
    const totalBatches = Math.ceil(allWorkItemIds.length / batchSize);

    for (let i = 0; i < allWorkItemIds.length; i += batchSize) {
      const batch = allWorkItemIds.slice(i, i + batchSize);
      const batchNumber = Math.floor(i / batchSize) + 1;
      console.log(`[Azure DevOps] Fetching work item details batch ${batchNumber}/${totalBatches} (${batch.length} items)`);
      
      try {
        const detailsData = await fetchAzureDevOps<{ value: AzureDevOpsWorkItem[] }>(
          config,
          `/wit/workitems?ids=${batch.join(",")}&$expand=all`
        );

        workItems.push(...(detailsData.value || []));
        console.log(`[Azure DevOps] Batch ${batchNumber}: Retrieved ${(detailsData.value || []).length} items`);
      } catch (batchError) {
        console.warn(`[Azure DevOps] Error fetching batch ${batchNumber}, continuing with other batches...`);
        // Continue with next batch even if one fails
      }
    }

    console.log(`[Azure DevOps] Fetched details for ${workItems.length} work items out of ${allWorkItemIds.length}`);
    return workItems;
  } catch (error) {
    console.error("[Azure DevOps] Failed to fetch work items:", error);
    throw error;
  }
}

function aggregateContributorStats(
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
    const name = commit.author.name;
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
    const name = pr.createdBy.displayName;
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
      if (!contributorMap.has(reviewer.displayName)) {
        contributorMap.set(reviewer.displayName, {
          name: reviewer.displayName,
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
        commitHoursByAuthor.set(reviewer.displayName, new Array(24).fill(0));
      }
      contributorMap.get(reviewer.displayName)!.pullRequestsReviewed++;
    }
  }

  for (const wi of workItems) {
    const assignee = wi.fields["System.AssignedTo"]?.displayName;
    if (assignee && contributorMap.has(assignee)) {
      if (wi.fields["System.WorkItemType"] === "Bug" && wi.fields["System.State"] === "Done") {
        contributorMap.get(assignee)!.bugsFixed++;
      }
      contributorMap.get(assignee)!.storyPointsDone += wi.fields["Microsoft.VSTS.Scheduling.StoryPoints"] || 0;
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

  return Array.from(contributorMap.values())
    .sort((a, b) => b.commits - a.commits)
    .slice(0, 10);
}

function aggregateModuleStats(workItems: AzureDevOpsWorkItem[]): Module[] {
  const moduleMap = new Map<string, Module>();

  for (const wi of workItems) {
    const areaPath = wi.fields["System.AreaPath"] || "General";
    const moduleName = areaPath.split("\\").pop() || "General";

    if (!moduleMap.has(moduleName)) {
      moduleMap.set(moduleName, {
        name: moduleName,
        commits: 0,
        pullRequests: 0,
        storyPointsDone: 0,
        status: "In Progress",
      });
    }

    const module = moduleMap.get(moduleName)!;
    module.storyPointsDone += wi.fields["Microsoft.VSTS.Scheduling.StoryPoints"] || 0;
    module.pullRequests++;
  }

  return Array.from(moduleMap.values())
    .sort((a, b) => b.storyPointsDone - a.storyPointsDone)
    .slice(0, 6);
}

function calculateTop5(
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
  prComments: number = 0,
  codeChanges: { linesAdded: number; linesDeleted: number; filesChanged: number },
  activityPattern: ActivityPattern
): string[] {
  const highlights: string[] = [];

  if (commits.length > 0) {
    highlights.push(`${commits.length.toLocaleString()} commits pushed`);
  }

  if (pullRequests.length > 0) {
    const mergedPRs = pullRequests.filter(pr => pr.status === "completed").length;
    highlights.push(`${mergedPRs} pull requests merged`);
  }

  if (prComments > 0) {
    highlights.push(`${prComments.toLocaleString()} code review comments`);
  }

  // Enhanced: Lines of code
  if (codeChanges.linesAdded > 0 || codeChanges.linesDeleted > 0) {
    const netLines = codeChanges.linesAdded - codeChanges.linesDeleted;
    highlights.push(`${codeChanges.filesChanged.toLocaleString()} files modified`);
  }

  // Count work items by type
  const workItemsByType = new Map<string, number>();
  for (const wi of workItems) {
    const type = wi.fields["System.WorkItemType"] || "Unknown";
    workItemsByType.set(type, (workItemsByType.get(type) || 0) + 1);
  }

  // Add type-specific highlights
  const bugs = workItemsByType.get("Bug") || 0;
  const bugsFixed = workItems.filter(
    wi => wi.fields["System.WorkItemType"] === "Bug" && wi.fields["System.State"] === "Done"
  ).length;
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

  const totalStoryPoints = workItems.reduce(
    (acc, wi) => acc + (wi.fields["Microsoft.VSTS.Scheduling.StoryPoints"] || 0),
    0
  );
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
  const doneWorkItems = workItems.filter(wi => wi.fields["System.State"] === "Done").length;
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

  if (dateFrom) {
    milestones.push({
      date: dateFrom,
      title: "Period Start",
      description: "Beginning of the tracking period",
      icon: "rocket",
    });
  }

  if (commits.length > 0) {
    const sortedCommits = [...commits].sort(
      (a, b) => new Date(a.author.date).getTime() - new Date(b.author.date).getTime()
    );
    const firstCommitDate = sortedCommits[0].author.date.split("T")[0];
    milestones.push({
      date: firstCommitDate,
      title: "First Commit",
      description: sortedCommits[0].comment?.substring(0, 50) || "Initial commit",
      icon: "lightbulb",
    });

    const midIndex = Math.floor(sortedCommits.length / 2);
    const midDate = sortedCommits[midIndex].author.date.split("T")[0];
    milestones.push({
      date: midDate,
      title: "Halfway Point",
      description: `${midIndex} commits so far`,
      icon: "flag",
    });
  }

  if (pullRequests.length >= 100 && dateTo) {
    milestones.push({
      date: dateTo,
      title: "100 PRs Milestone",
      description: "Team collaboration at scale",
      icon: "party",
    });
  }

  if (dateTo) {
    milestones.push({
      date: dateTo,
      title: "Period End",
      description: "End of tracking period",
      icon: "lock",
    });
  }

  return milestones.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
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
