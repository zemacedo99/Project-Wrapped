import https from "https";
import type { ProjectWrappedData, Contributor, Module, Milestone, Top5 } from "@shared/schema";

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

  const [commits, pullRequests, workItems, prComments, commits_with_files] = await Promise.all([
    fetchCommits(config, dateFrom, dateTo),
    fetchPullRequests(config),
    fetchWorkItems(config, dateFrom, dateTo),
    fetchPullRequestComments(config),
    fetchCommitChanges(config, dateFrom, dateTo),
  ]);

  console.log(`[Azure DevOps] Fetched: ${commits.length} commits, ${pullRequests.length} PRs, ${workItems.length} work items, ${prComments} PR comments`);

  const contributorStats = aggregateContributorStats(commits, pullRequests, workItems);
  const moduleStats = aggregateModuleStats(workItems);
  const top5 = calculateTop5(contributorStats, commits);
  const highlights = generateHighlights(commits, pullRequests, workItems, prComments);
  const milestones = generateMilestones(commits, pullRequests, workItems, dateFrom, dateTo);

  const totalStats = {
    totalCommits: commits.length,
    totalPullRequests: pullRequests.length,
    totalReviews: pullRequests.reduce((acc, pr) => acc + (pr.reviewers?.length || 0), 0),
    totalComments: prComments,
    totalBugsFixed: workItems.filter(wi => wi.fields["System.WorkItemType"] === "Bug" && wi.fields["System.State"] === "Done").length,
    totalStoryPointsDone: workItems.reduce((acc, wi) => acc + (wi.fields["Microsoft.VSTS.Scheduling.StoryPoints"] || 0), 0),
    sprintsCompleted: dateFrom && dateTo ? Math.floor((new Date(dateTo).getTime() - new Date(dateFrom).getTime()) / (14 * 24 * 60 * 60 * 1000)) : 0,
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
  };
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
  workItems: AzureDevOpsWorkItem[]
): Contributor[] {
  const contributorMap = new Map<string, Contributor>();

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
      });
    }
    contributorMap.get(name)!.commits++;
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
      });
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
        });
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

function calculateTop5(contributors: Contributor[], commits: AzureDevOpsCommit[]): Top5 {
  const commitsByDate = new Map<string, number>();
  for (const commit of commits) {
    const date = commit.author.date.split("T")[0];
    commitsByDate.set(date, (commitsByDate.get(date) || 0) + 1);
  }

  const busiestDays = Array.from(commitsByDate.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([date, count]) => ({ date, commits: count }));

  return {
    mostCommits: contributors
      .sort((a, b) => b.commits - a.commits)
      .slice(0, 5)
      .map(c => ({ name: c.name, commits: c.commits })),
    mostPullRequestsOpened: contributors
      .sort((a, b) => b.pullRequestsOpened - a.pullRequestsOpened)
      .slice(0, 5)
      .map(c => ({ name: c.name, pullRequestsOpened: c.pullRequestsOpened })),
    mostPullRequestsReviewed: contributors
      .sort((a, b) => b.pullRequestsReviewed - a.pullRequestsReviewed)
      .slice(0, 5)
      .map(c => ({ name: c.name, pullRequestsReviewed: c.pullRequestsReviewed })),
    mostCommentsWritten: contributors
      .sort((a, b) => b.commentsWritten - a.commentsWritten)
      .slice(0, 5)
      .map(c => ({ name: c.name, commentsWritten: c.commentsWritten })),
    busiestDaysByCommits: busiestDays,
  };
}

function generateHighlights(
  commits: AzureDevOpsCommit[],
  pullRequests: AzureDevOpsPullRequest[],
  workItems: AzureDevOpsWorkItem[],
  prComments: number = 0
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
    highlights.push(`${prComments} code review comments`);
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

  return highlights.slice(0, 8);
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
