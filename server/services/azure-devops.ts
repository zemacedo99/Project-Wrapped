import type { ProjectWrappedData, Contributor, Module, Milestone, Top5 } from "@shared/schema";

interface AzureDevOpsConfig {
  organization: string;
  project: string;
  personalAccessToken: string;
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
  apiVersion: string = "7.0"
): Promise<T> {
  const baseUrl = `https://dev.azure.com/${config.organization}/${config.project}/_apis`;
  const url = `${baseUrl}${apiPath}${apiPath.includes("?") ? "&" : "?"}api-version=${apiVersion}`;

  console.log(`[Azure DevOps] Fetching: ${apiPath}`);

  const response = await fetch(url, {
    headers: {
      Authorization: `Basic ${Buffer.from(`:${config.personalAccessToken}`).toString("base64")}`,
      "Content-Type": "application/json",
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error(`[Azure DevOps] API error: ${response.status} - ${errorText}`);
    
    if (response.status === 401) {
      throw new Error("Authentication failed. Please check your Personal Access Token has the correct permissions (Code: Read, Work Items: Read).");
    } else if (response.status === 404) {
      throw new Error(`Resource not found. Please verify your organization '${config.organization}' and project '${config.project}' names are correct.`);
    } else if (response.status === 403) {
      throw new Error("Access denied. Your PAT may not have sufficient permissions. Required: Code (Read), Work Items (Read).");
    }
    
    throw new Error(`Azure DevOps API error (${response.status}): ${errorText}`);
  }

  return response.json();
}

export async function fetchAzureDevOpsData(config: AzureDevOpsConfig): Promise<ProjectWrappedData> {
  const dateFrom = config.dateFrom || new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];
  const dateTo = config.dateTo || new Date().toISOString().split("T")[0];

  console.log(`[Azure DevOps] Fetching data for ${config.organization}/${config.project}`);
  console.log(`[Azure DevOps] Date range: ${dateFrom} to ${dateTo}`);

  const [commits, pullRequests, workItems] = await Promise.all([
    fetchCommits(config, dateFrom, dateTo),
    fetchPullRequests(config),
    fetchWorkItems(config, dateFrom, dateTo),
  ]);

  console.log(`[Azure DevOps] Fetched: ${commits.length} commits, ${pullRequests.length} PRs, ${workItems.length} work items`);

  const contributorStats = aggregateContributorStats(commits, pullRequests, workItems);
  const moduleStats = aggregateModuleStats(workItems);
  const top5 = calculateTop5(contributorStats, commits);
  const highlights = generateHighlights(commits, pullRequests, workItems);
  const milestones = generateMilestones(commits, pullRequests, workItems, dateFrom, dateTo);

  const totalStats = {
    totalCommits: commits.length,
    totalPullRequests: pullRequests.length,
    totalReviews: pullRequests.reduce((acc, pr) => acc + (pr.reviewers?.length || 0), 0),
    totalComments: 0,
    totalBugsFixed: workItems.filter(wi => wi.fields["System.WorkItemType"] === "Bug" && wi.fields["System.State"] === "Done").length,
    totalStoryPointsDone: workItems.reduce((acc, wi) => acc + (wi.fields["Microsoft.VSTS.Scheduling.StoryPoints"] || 0), 0),
    sprintsCompleted: Math.floor((new Date(dateTo).getTime() - new Date(dateFrom).getTime()) / (14 * 24 * 60 * 60 * 1000)),
  };

  console.log(`[Azure DevOps] Aggregated ${contributorStats.length} contributors, ${moduleStats.length} modules`);

  return {
    projectName: config.project,
    version: "1.0",
    dateRange: {
      start: dateFrom,
      end: dateTo,
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
  dateFrom: string,
  dateTo: string
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
        const commitsResponse = await fetchAzureDevOps<{ value: AzureDevOpsCommit[] }>(
          config,
          `/git/repositories/${repo.id}/commits?searchCriteria.fromDate=${dateFrom}&searchCriteria.toDate=${dateTo}&$top=1000`
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

async function fetchWorkItems(
  config: AzureDevOpsConfig,
  dateFrom: string,
  dateTo: string
): Promise<AzureDevOpsWorkItem[]> {
  try {
    console.log(`[Azure DevOps] Querying work items...`);
    const wiqlQuery = {
      query: `SELECT [System.Id] FROM workitems WHERE [System.TeamProject] = '${config.project}' AND [System.CreatedDate] >= '${dateFrom}' AND [System.CreatedDate] <= '${dateTo}' ORDER BY [System.CreatedDate] DESC`,
    };

    const queryResult = await fetch(
      `https://dev.azure.com/${config.organization}/${config.project}/_apis/wit/wiql?api-version=7.0`,
      {
        method: "POST",
        headers: {
          Authorization: `Basic ${Buffer.from(`:${config.personalAccessToken}`).toString("base64")}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(wiqlQuery),
      }
    );

    if (!queryResult.ok) {
      const errorText = await queryResult.text();
      console.error(`[Azure DevOps] WIQL query failed: ${queryResult.status} - ${errorText}`);
      throw new Error(`WIQL query failed: ${queryResult.status}`);
    }

    const queryData = await queryResult.json();
    const workItemIds = queryData.workItems?.slice(0, 500).map((wi: { id: number }) => wi.id) || [];

    console.log(`[Azure DevOps] Found ${workItemIds.length} work items`);

    if (workItemIds.length === 0) {
      return [];
    }

    const batchSize = 200;
    const workItems: AzureDevOpsWorkItem[] = [];

    for (let i = 0; i < workItemIds.length; i += batchSize) {
      const batch = workItemIds.slice(i, i + batchSize);
      console.log(`[Azure DevOps] Fetching work item details batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(workItemIds.length / batchSize)}`);
      const detailsUrl = `https://dev.azure.com/${config.organization}/${config.project}/_apis/wit/workitems?ids=${batch.join(",")}&api-version=7.0`;

      const detailsResponse = await fetch(detailsUrl, {
        headers: {
          Authorization: `Basic ${Buffer.from(`:${config.personalAccessToken}`).toString("base64")}`,
          "Content-Type": "application/json",
        },
      });

      if (detailsResponse.ok) {
        const detailsData = await detailsResponse.json();
        workItems.push(...(detailsData.value || []));
      } else {
        console.warn(`[Azure DevOps] Failed to fetch work item details batch: ${detailsResponse.status}`);
      }
    }

    console.log(`[Azure DevOps] Fetched details for ${workItems.length} work items`);
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
  workItems: AzureDevOpsWorkItem[]
): string[] {
  const highlights: string[] = [];

  if (commits.length > 0) {
    highlights.push(`${commits.length.toLocaleString()} commits pushed`);
  }

  if (pullRequests.length > 0) {
    const mergedPRs = pullRequests.filter(pr => pr.status === "completed").length;
    highlights.push(`${mergedPRs} pull requests merged`);
  }

  const bugsFixed = workItems.filter(
    wi => wi.fields["System.WorkItemType"] === "Bug" && wi.fields["System.State"] === "Done"
  ).length;
  if (bugsFixed > 0) {
    highlights.push(`${bugsFixed} bugs squashed`);
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

  const features = workItems.filter(wi => wi.fields["System.WorkItemType"] === "User Story").length;
  if (features > 0) {
    highlights.push(`${features} user stories completed`);
  }

  return highlights.slice(0, 6);
}

function generateMilestones(
  commits: AzureDevOpsCommit[],
  pullRequests: AzureDevOpsPullRequest[],
  workItems: AzureDevOpsWorkItem[],
  dateFrom: string,
  dateTo: string
): Milestone[] {
  const milestones: Milestone[] = [];

  milestones.push({
    date: dateFrom,
    title: "Period Start",
    description: "Beginning of the tracking period",
    icon: "rocket",
  });

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

  if (pullRequests.length >= 100) {
    milestones.push({
      date: dateTo,
      title: "100 PRs Milestone",
      description: "Team collaboration at scale",
      icon: "party",
    });
  }

  milestones.push({
    date: dateTo,
    title: "Period End",
    description: "End of tracking period",
    icon: "lock",
  });

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
    
    // Test 1: Fetch project details
    const projectResponse = await fetchAzureDevOps<{ name: string; description: string }>(
      config,
      \"/\" // Project endpoint
    );
    
    console.log(`[Azure DevOps] Successfully connected to project: ${projectResponse.name}`);
    
    // Test 2: Check repository access
    const reposResponse = await fetchAzureDevOps<{ value: Array<{ id: string; name: string }> }>(
      config,
      \"/git/repositories\"
    );
    
    console.log(`[Azure DevOps] Found ${reposResponse.value.length} repositories`);
    
    return {
      success: true,
      message: `Successfully connected to ${config.project}`,
      details: {
        projectName: projectResponse.name,
        repositoryCount: reposResponse.value.length,
        repositories: reposResponse.value.map(r => r.name),
      }
    };
  } catch (error) {
    console.error(\"[Azure DevOps] Connection test failed:\", error);
    return {
      success: false,
      message: error instanceof Error ? error.message : \"Connection test failed\",
    };
  }
}
