import type { ProjectWrappedData, Contributor, Module, Milestone, Top5 } from "@shared/schema";

interface GitHubConfig {
  owner: string;
  repo: string;
  personalAccessToken?: string;
  dateFrom?: string;
  dateTo?: string;
}

interface GitHubCommit {
  sha: string;
  commit: {
    author: {
      name: string;
      email: string;
      date: string;
    };
    message: string;
  };
  author?: {
    login: string;
  };
}

interface GitHubPullRequest {
  id: number;
  number: number;
  title: string;
  state: string;
  user: {
    login: string;
  };
  created_at: string;
  closed_at?: string;
  merged_at?: string;
  requested_reviewers?: Array<{ login: string }>;
}

interface GitHubIssue {
  id: number;
  number: number;
  title: string;
  state: string;
  labels: Array<{ name: string }>;
  assignee?: {
    login: string;
  };
  created_at: string;
  closed_at?: string;
}

interface GitHubContributor {
  login: string;
  contributions: number;
}

async function fetchGitHub<T>(
  config: GitHubConfig,
  apiPath: string
): Promise<T> {
  const url = `https://api.github.com${apiPath}`;
  const headers: Record<string, string> = {
    Accept: "application/vnd.github.v3+json",
    "User-Agent": "Project-Wrapped-App",
  };

  if (config.personalAccessToken) {
    headers.Authorization = `Bearer ${config.personalAccessToken}`;
  }

  const response = await fetch(url, { headers });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`GitHub API error: ${response.status} - ${errorText}`);
  }

  return response.json();
}

export async function fetchGitHubData(config: GitHubConfig): Promise<ProjectWrappedData> {
  const dateFrom = config.dateFrom || new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];
  const dateTo = config.dateTo || new Date().toISOString().split("T")[0];

  const [repoInfo, commits, pullRequests, issues, contributors] = await Promise.all([
    fetchRepoInfo(config),
    fetchCommits(config, dateFrom, dateTo),
    fetchPullRequests(config),
    fetchIssues(config),
    fetchContributors(config),
  ]);

  const contributorStats = aggregateContributorStats(commits, pullRequests, issues, contributors);
  const moduleStats = aggregateModuleStats(issues);
  const top5 = calculateTop5(contributorStats, commits);
  const highlights = generateHighlights(commits, pullRequests, issues, repoInfo);
  const milestones = generateMilestones(commits, pullRequests, dateFrom, dateTo);

  const totalStats = {
    totalCommits: commits.length,
    totalPullRequests: pullRequests.length,
    totalReviews: pullRequests.reduce((acc, pr) => acc + (pr.requested_reviewers?.length || 0), 0),
    totalComments: 0,
    totalBugsFixed: issues.filter(i => i.labels.some(l => l.name.toLowerCase().includes("bug")) && i.state === "closed").length,
    totalStoryPointsDone: issues.filter(i => i.state === "closed").length * 2,
    sprintsCompleted: Math.floor((new Date(dateTo).getTime() - new Date(dateFrom).getTime()) / (14 * 24 * 60 * 60 * 1000)),
  };

  return {
    projectName: `${config.owner}/${config.repo}`,
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

async function fetchRepoInfo(config: GitHubConfig): Promise<{ stargazers_count: number; forks_count: number; open_issues_count: number }> {
  try {
    return await fetchGitHub(config, `/repos/${config.owner}/${config.repo}`);
  } catch {
    return { stargazers_count: 0, forks_count: 0, open_issues_count: 0 };
  }
}

async function fetchCommits(
  config: GitHubConfig,
  dateFrom: string,
  dateTo: string
): Promise<GitHubCommit[]> {
  try {
    const allCommits: GitHubCommit[] = [];
    let page = 1;
    const perPage = 100;

    while (page <= 10) {
      const commits = await fetchGitHub<GitHubCommit[]>(
        config,
        `/repos/${config.owner}/${config.repo}/commits?since=${dateFrom}T00:00:00Z&until=${dateTo}T23:59:59Z&per_page=${perPage}&page=${page}`
      );

      if (commits.length === 0) break;
      allCommits.push(...commits);
      if (commits.length < perPage) break;
      page++;
    }

    return allCommits;
  } catch (error) {
    console.error("Failed to fetch commits:", error);
    return [];
  }
}

async function fetchPullRequests(config: GitHubConfig): Promise<GitHubPullRequest[]> {
  try {
    const allPRs: GitHubPullRequest[] = [];
    let page = 1;
    const perPage = 100;

    while (page <= 5) {
      const prs = await fetchGitHub<GitHubPullRequest[]>(
        config,
        `/repos/${config.owner}/${config.repo}/pulls?state=all&per_page=${perPage}&page=${page}`
      );

      if (prs.length === 0) break;
      allPRs.push(...prs);
      if (prs.length < perPage) break;
      page++;
    }

    return allPRs;
  } catch (error) {
    console.error("Failed to fetch pull requests:", error);
    return [];
  }
}

async function fetchIssues(config: GitHubConfig): Promise<GitHubIssue[]> {
  try {
    const allIssues: GitHubIssue[] = [];
    let page = 1;
    const perPage = 100;

    while (page <= 5) {
      const issues = await fetchGitHub<GitHubIssue[]>(
        config,
        `/repos/${config.owner}/${config.repo}/issues?state=all&per_page=${perPage}&page=${page}`
      );

      if (issues.length === 0) break;
      allIssues.push(...issues);
      if (issues.length < perPage) break;
      page++;
    }

    return allIssues;
  } catch (error) {
    console.error("Failed to fetch issues:", error);
    return [];
  }
}

async function fetchContributors(config: GitHubConfig): Promise<GitHubContributor[]> {
  try {
    return await fetchGitHub<GitHubContributor[]>(
      config,
      `/repos/${config.owner}/${config.repo}/contributors?per_page=50`
    );
  } catch (error) {
    console.error("Failed to fetch contributors:", error);
    return [];
  }
}

function aggregateContributorStats(
  commits: GitHubCommit[],
  pullRequests: GitHubPullRequest[],
  issues: GitHubIssue[],
  contributors: GitHubContributor[]
): Contributor[] {
  const contributorMap = new Map<string, Contributor>();

  for (const contributor of contributors) {
    contributorMap.set(contributor.login, {
      name: contributor.login,
      commits: contributor.contributions,
      pullRequestsOpened: 0,
      pullRequestsReviewed: 0,
      commentsWritten: 0,
      bugsFixed: 0,
      storyPointsDone: 0,
    });
  }

  for (const commit of commits) {
    const name = commit.author?.login || commit.commit.author.name;
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
    if (!contributors.find(c => c.login === name)) {
      contributorMap.get(name)!.commits++;
    }
  }

  for (const pr of pullRequests) {
    const name = pr.user.login;
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

    for (const reviewer of pr.requested_reviewers || []) {
      if (!contributorMap.has(reviewer.login)) {
        contributorMap.set(reviewer.login, {
          name: reviewer.login,
          commits: 0,
          pullRequestsOpened: 0,
          pullRequestsReviewed: 0,
          commentsWritten: 0,
          bugsFixed: 0,
          storyPointsDone: 0,
        });
      }
      contributorMap.get(reviewer.login)!.pullRequestsReviewed++;
    }
  }

  for (const issue of issues) {
    if (issue.assignee && issue.state === "closed") {
      const name = issue.assignee.login;
      if (contributorMap.has(name)) {
        if (issue.labels.some(l => l.name.toLowerCase().includes("bug"))) {
          contributorMap.get(name)!.bugsFixed++;
        }
        contributorMap.get(name)!.storyPointsDone += 2;
      }
    }
  }

  return Array.from(contributorMap.values())
    .sort((a, b) => b.commits - a.commits)
    .slice(0, 10);
}

function aggregateModuleStats(issues: GitHubIssue[]): Module[] {
  const labelMap = new Map<string, Module>();

  for (const issue of issues) {
    for (const label of issue.labels) {
      const labelName = label.name;
      if (labelName.toLowerCase().includes("bug") || labelName.toLowerCase().includes("enhancement")) continue;

      if (!labelMap.has(labelName)) {
        labelMap.set(labelName, {
          name: labelName,
          commits: 0,
          pullRequests: 0,
          storyPointsDone: 0,
          status: "In Progress",
        });
      }

      const module = labelMap.get(labelName)!;
      module.pullRequests++;
      if (issue.state === "closed") {
        module.storyPointsDone += 2;
      }
    }
  }

  const modules = Array.from(labelMap.values())
    .sort((a, b) => b.pullRequests - a.pullRequests)
    .slice(0, 6);

  if (modules.length === 0) {
    return [{
      name: "General",
      commits: 0,
      pullRequests: issues.length,
      storyPointsDone: issues.filter(i => i.state === "closed").length * 2,
      status: "In Progress",
    }];
  }

  return modules;
}

function calculateTop5(contributors: Contributor[], commits: GitHubCommit[]): Top5 {
  const commitsByDate = new Map<string, number>();
  for (const commit of commits) {
    const date = commit.commit.author.date.split("T")[0];
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
  commits: GitHubCommit[],
  pullRequests: GitHubPullRequest[],
  issues: GitHubIssue[],
  repoInfo: { stargazers_count: number; forks_count: number }
): string[] {
  const highlights: string[] = [];

  if (commits.length > 0) {
    highlights.push(`${commits.length.toLocaleString()} commits pushed`);
  }

  const mergedPRs = pullRequests.filter(pr => pr.merged_at).length;
  if (mergedPRs > 0) {
    highlights.push(`${mergedPRs} pull requests merged`);
  }

  const bugsClosed = issues.filter(
    i => i.labels.some(l => l.name.toLowerCase().includes("bug")) && i.state === "closed"
  ).length;
  if (bugsClosed > 0) {
    highlights.push(`${bugsClosed} bugs squashed`);
  }

  const issuesClosed = issues.filter(i => i.state === "closed").length;
  if (issuesClosed > 0) {
    highlights.push(`${issuesClosed} issues resolved`);
  }

  if (repoInfo.stargazers_count > 0) {
    highlights.push(`${repoInfo.stargazers_count} stars on GitHub`);
  }

  if (repoInfo.forks_count > 0) {
    highlights.push(`${repoInfo.forks_count} forks created`);
  }

  const uniqueContributors = new Set(commits.map(c => c.author?.login || c.commit.author.name)).size;
  if (uniqueContributors > 0) {
    highlights.push(`${uniqueContributors} contributors`);
  }

  return highlights.slice(0, 6);
}

function generateMilestones(
  commits: GitHubCommit[],
  pullRequests: GitHubPullRequest[],
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
      (a, b) => new Date(a.commit.author.date).getTime() - new Date(b.commit.author.date).getTime()
    );
    const firstCommitDate = sortedCommits[0].commit.author.date.split("T")[0];
    milestones.push({
      date: firstCommitDate,
      title: "First Commit",
      description: sortedCommits[0].commit.message?.substring(0, 50) || "Initial commit",
      icon: "lightbulb",
    });

    const midIndex = Math.floor(sortedCommits.length / 2);
    if (midIndex > 0) {
      const midDate = sortedCommits[midIndex].commit.author.date.split("T")[0];
      milestones.push({
        date: midDate,
        title: "Halfway Point",
        description: `${midIndex} commits milestone`,
        icon: "flag",
      });
    }
  }

  if (pullRequests.length >= 50) {
    milestones.push({
      date: dateTo,
      title: "50 PRs Milestone",
      description: "Strong team collaboration",
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

export function validateGitHubConfig(config: Partial<GitHubConfig>): string[] {
  const errors: string[] = [];

  if (!config.owner?.trim()) {
    errors.push("Repository owner is required");
  }

  if (!config.repo?.trim()) {
    errors.push("Repository name is required");
  }

  return errors;
}
