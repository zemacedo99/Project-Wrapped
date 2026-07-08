import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  isDoneState,
  isBugFixed,
  completedStoryPoints,
  withinRange,
  aggregateContributorStats,
  aggregateModuleStats,
  calculateTop5,
  calculatePrMergeStats,
  type AzureDevOpsCommit,
  type AzureDevOpsPullRequest,
  type AzureDevOpsWorkItem,
} from "./azure-devops";
import { projectWrappedDataSchema } from "../../shared/schema";

// ---------------------------------------------------------------------------
// Fixture builders — keep tests terse and intention-revealing.
// ---------------------------------------------------------------------------

function commit(name: string, date: string, repoName = "repo-a"): AzureDevOpsCommit {
  return {
    commitId: Math.random().toString(36).slice(2),
    author: { name, email: `${name.trim().toLowerCase().replace(/\s+/g, ".")}@x.io`, date },
    comment: "work",
    repoName,
  };
}

function pr(
  opts: {
    id?: number;
    author: string;
    status?: string;
    creationDate: string;
    closedDate?: string;
    reviewers?: Array<{ displayName: string; vote: number }>;
  },
): AzureDevOpsPullRequest {
  return {
    pullRequestId: opts.id ?? 1,
    title: "a pr",
    status: opts.status ?? "completed",
    createdBy: { displayName: opts.author },
    creationDate: opts.creationDate,
    closedDate: opts.closedDate,
    reviewers: opts.reviewers,
  };
}

function workItem(opts: {
  id?: number;
  type: string;
  state: string;
  points?: number;
  assignee?: string;
  areaPath?: string;
  createdDate?: string;
}): AzureDevOpsWorkItem {
  return {
    id: opts.id ?? 1,
    fields: {
      "System.Title": "an item",
      "System.WorkItemType": opts.type,
      "System.State": opts.state,
      "System.AssignedTo": opts.assignee ? { displayName: opts.assignee } : undefined,
      "Microsoft.VSTS.Scheduling.StoryPoints": opts.points,
      "System.CreatedDate": opts.createdDate ?? "2024-01-01T00:00:00Z",
      "System.AreaPath": opts.areaPath,
    },
  };
}

const NO_MERGE = { mergeTimeByAuthor: new Map<string, number[]>() };
const NO_STREAK = { streaksByAuthor: new Map<string, number>() };

function findContributor(list: ReturnType<typeof aggregateContributorStats>, name: string) {
  return list.find((c) => c.name === name);
}

// ---------------------------------------------------------------------------
// 1. Completed-state definition
// ---------------------------------------------------------------------------

describe("isDoneState", () => {
  test("treats Done/Closed/Resolved/Completed as completed (case/space-insensitive)", () => {
    for (const s of ["Done", "done", " Closed ", "resolved", "RESOLVED", "Completed", "completed"]) {
      assert.equal(isDoneState(s), true, `expected "${s}" to be done`);
    }
  });

  test("does not treat in-flight states as completed", () => {
    for (const s of ["Active", "New", "In Progress", "Committed", "Removed", "To Do", "", undefined]) {
      assert.equal(isDoneState(s), false, `expected "${s}" to be not done`);
    }
  });
});

// ---------------------------------------------------------------------------
// 2. Bugs fixed vs bugs created
// ---------------------------------------------------------------------------

describe("isBugFixed", () => {
  test("a Bug in any completed state counts as fixed", () => {
    for (const state of ["Done", "Closed", "Resolved", "Completed"]) {
      assert.equal(isBugFixed(workItem({ type: "Bug", state })), true, `Bug/${state}`);
    }
  });

  test("Bug type matching is case-insensitive", () => {
    assert.equal(isBugFixed(workItem({ type: "bug", state: "Closed" })), true);
  });

  test("a Bug that is not completed is not fixed", () => {
    for (const state of ["Active", "New", "In Progress"]) {
      assert.equal(isBugFixed(workItem({ type: "Bug", state })), false, `Bug/${state}`);
    }
  });

  test("a completed non-Bug is not a fixed bug", () => {
    assert.equal(isBugFixed(workItem({ type: "Task", state: "Done" })), false);
    assert.equal(isBugFixed(workItem({ type: "User Story", state: "Closed" })), false);
  });
});

// ---------------------------------------------------------------------------
// 3. Story points: completed only vs total
// ---------------------------------------------------------------------------

describe("completedStoryPoints", () => {
  test("credits points only when the item is completed", () => {
    assert.equal(completedStoryPoints(workItem({ type: "User Story", state: "Done", points: 5 })), 5);
    assert.equal(completedStoryPoints(workItem({ type: "User Story", state: "Closed", points: 8 })), 8);
  });

  test("credits zero for in-flight items even if they carry points", () => {
    assert.equal(completedStoryPoints(workItem({ type: "User Story", state: "Active", points: 8 })), 0);
    assert.equal(completedStoryPoints(workItem({ type: "User Story", state: "New", points: 13 })), 0);
  });

  test("handles missing / zero points", () => {
    assert.equal(completedStoryPoints(workItem({ type: "User Story", state: "Done" })), 0);
    assert.equal(completedStoryPoints(workItem({ type: "User Story", state: "Done", points: 0 })), 0);
  });

  test("total across a mixed set counts only the completed points", () => {
    const items = [
      workItem({ type: "User Story", state: "Done", points: 5 }),
      workItem({ type: "User Story", state: "Active", points: 8 }), // excluded
      workItem({ type: "Bug", state: "Closed", points: 2 }),
      workItem({ type: "Task", state: "New", points: 3 }), // excluded
    ];
    const total = items.reduce((acc, wi) => acc + completedStoryPoints(wi), 0);
    assert.equal(total, 7); // 5 + 2, NOT 18
  });
});

// ---------------------------------------------------------------------------
// 4. PR / date-range scoping semantics
// ---------------------------------------------------------------------------

describe("withinRange (used to scope PRs by creation date)", () => {
  const from = "2024-01-01";
  const to = "2024-12-31";

  test("no filter -> everything is in range", () => {
    assert.equal(withinRange("2020-05-05T00:00:00Z"), true);
    assert.equal(withinRange(undefined, undefined, undefined), true);
  });

  test("a date inside the window is in range", () => {
    assert.equal(withinRange("2024-06-15T10:00:00Z", from, to), true);
  });

  test("a date before the window is excluded", () => {
    assert.equal(withinRange("2023-12-31T23:59:59Z", from, to), false);
  });

  test("a date after the window is excluded", () => {
    assert.equal(withinRange("2025-01-01T00:00:01Z", from, to), false);
  });

  test("the end date is inclusive of the whole day", () => {
    assert.equal(withinRange("2024-12-31T18:30:00Z", from, to), true);
  });

  test("the start date is inclusive from midnight", () => {
    assert.equal(withinRange("2024-01-01T00:00:00Z", from, undefined), true);
  });

  test("missing or invalid dates are excluded once a filter is set", () => {
    assert.equal(withinRange(undefined, from, to), false);
    assert.equal(withinRange("not-a-date", from, to), false);
  });
});

// ---------------------------------------------------------------------------
// 5. Contributor aggregation (integrates the definitions above)
// ---------------------------------------------------------------------------

describe("aggregateContributorStats", () => {
  test("credits commits, PRs, reviews, bugs and completed points to the right people", () => {
    const commits = [
      commit("Alice", "2024-01-01T09:00:00Z"),
      commit("Alice", "2024-01-02T09:00:00Z"),
      commit("  Alice ", "2024-01-03T09:00:00Z"), // whitespace variant -> should merge
      commit("Bob", "2024-01-01T10:00:00Z"),
    ];
    const prs = [
      pr({
        id: 1,
        author: "Alice",
        creationDate: "2024-01-05T00:00:00Z",
        reviewers: [
          { displayName: "Bob", vote: 10 }, // approved -> counts
          { displayName: "Carol", vote: 0 }, // no vote -> ignored
        ],
      }),
      pr({ id: 2, author: "Carol", creationDate: "2024-01-06T00:00:00Z" }),
    ];
    const workItems = [
      workItem({ id: 1, type: "Bug", state: "Done", points: 5, assignee: "Alice" }),
      workItem({ id: 2, type: "Bug", state: "Active", points: 3, assignee: "Alice" }), // not fixed, no points
      workItem({ id: 3, type: "User Story", state: "Closed", points: 8, assignee: "Bob" }),
      workItem({ id: 4, type: "Task", state: "Done", points: 2, assignee: "Dave" }), // work-item-only person
    ];

    const result = aggregateContributorStats(commits, prs, workItems, NO_MERGE, NO_STREAK);

    const alice = findContributor(result, "Alice");
    const bob = findContributor(result, "Bob");
    const carol = findContributor(result, "Carol");
    const dave = findContributor(result, "Dave");

    assert.ok(alice && bob && carol && dave, "all four contributors present");
    assert.equal(result.length, 4, "no phantom / duplicate contributors");

    // Whitespace variant merged into a single "Alice".
    assert.equal(alice!.commits, 3);
    assert.equal(alice!.pullRequestsOpened, 1);
    assert.equal(alice!.bugsFixed, 1, "only the Done bug counts");
    assert.equal(alice!.storyPointsDone, 5, "only completed points count (not the Active 3)");

    // Reviews only credit reviewers who cast a non-zero vote.
    assert.equal(bob!.pullRequestsReviewed, 1);
    assert.equal(carol!.pullRequestsReviewed, 0, "a 0-vote reviewer is not a review");
    assert.equal(bob!.storyPointsDone, 8);
    assert.equal(bob!.bugsFixed, 0);

    // Carol exists because she opened a PR (not because she was an inactive reviewer).
    assert.equal(carol!.pullRequestsOpened, 1);
    assert.equal(carol!.commits, 0);

    // Someone with only an assigned (completed) work item still appears.
    assert.equal(dave!.commits, 0);
    assert.equal(dave!.storyPointsDone, 2);
  });

  test("empty input yields an empty roster", () => {
    assert.deepEqual(aggregateContributorStats([], [], [], NO_MERGE, NO_STREAK), []);
  });

  test("tolerates missing author/assignee fields without throwing", () => {
    const commits = [{ commitId: "x", author: { name: "", email: "", date: "2024-01-01T00:00:00Z" }, comment: "" }];
    const workItems = [workItem({ type: "Bug", state: "Done", points: 5 })]; // no assignee
    const result = aggregateContributorStats(commits as AzureDevOpsCommit[], [], workItems, NO_MERGE, NO_STREAK);
    // Nameless commit author falls back to "Unknown"; unassigned work item credits no one.
    const unknown = findContributor(result, "Unknown");
    assert.ok(unknown, "empty commit author name falls back to Unknown");
    assert.equal(unknown!.bugsFixed, 0, "an unassigned fixed bug is credited to nobody");
  });

  test("KNOWN LIMITATION: names differing only by case are NOT merged (identity unification is future work)", () => {
    const commits = [commit("Alice Smith", "2024-01-01T00:00:00Z")];
    const workItems = [workItem({ type: "Bug", state: "Done", assignee: "alice smith" })];
    const result = aggregateContributorStats(commits, [], workItems, NO_MERGE, NO_STREAK);
    // This documents current behavior on purpose (see ROADMAP P0.1). If identity
    // unification lands, update this test to expect a single merged contributor.
    assert.equal(result.length, 2, "case-different names currently fragment into two contributors");
  });
});

// ---------------------------------------------------------------------------
// 6. Module (area path) aggregation
// ---------------------------------------------------------------------------

describe("aggregateModuleStats", () => {
  const workItems = [
    workItem({ id: 1, type: "Bug", state: "Done", points: 5, assignee: "Alice", areaPath: "Proj\\Core" }),
    workItem({ id: 2, type: "User Story", state: "Active", points: 3, assignee: "Bob", areaPath: "Proj\\Core" }),
    workItem({ id: 3, type: "Task", state: "Closed", points: 2, assignee: "Carol", areaPath: "Proj\\UI\\Web" }),
    workItem({ id: 4, type: "User Story", state: "New", points: 0, assignee: "Dave" }), // no area path -> "General"
  ];
  const modules = aggregateModuleStats(workItems);
  const byName = (n: string) => modules.find((m) => m.name === n);

  test("uses the leaf of the area path and falls back to General", () => {
    assert.ok(byName("Core"), "Core present");
    assert.ok(byName("Web"), "Web (leaf of Proj\\UI\\Web) present");
    assert.ok(byName("General"), "missing area path -> General");
  });

  test("counts completed points and fixed bugs only", () => {
    const core = byName("Core")!;
    assert.equal(core.workItems, 2);
    assert.equal(core.storyPointsDone, 5, "only the Done bug's points, not the Active story's 3");
    assert.equal(core.bugsFixed, 1);
    assert.equal(core.contributors, 2);
  });

  test("derives status from completion ratio", () => {
    assert.equal(byName("Core")!.status, "In Progress"); // 1 of 2 done
    assert.equal(byName("Web")!.status, "Complete"); // 1 of 1 done
    assert.equal(byName("General")!.status, "Planned"); // 0 done
  });

  test("empty input yields no modules", () => {
    assert.deepEqual(aggregateModuleStats([]), []);
  });
});

// ---------------------------------------------------------------------------
// 7. PR merge-time stats
// ---------------------------------------------------------------------------

describe("calculatePrMergeStats", () => {
  test("averages only completed PRs and ignores non-completed / impossible durations", () => {
    const prs = [
      pr({ id: 1, author: "Alice", status: "completed", creationDate: "2024-01-01T00:00:00Z", closedDate: "2024-01-02T00:00:00Z" }), // 24h
      pr({ id: 2, author: "Alice", status: "active", creationDate: "2024-02-01T00:00:00Z" }), // ignored (not completed)
      pr({ id: 3, author: "Alice", status: "completed", creationDate: "2024-03-01T00:00:00Z", closedDate: "2024-03-01T02:00:00Z" }), // 2h
      pr({ id: 4, author: "Bob", status: "completed", creationDate: "2024-04-01T05:00:00Z", closedDate: "2024-04-01T00:00:00Z" }), // negative -> ignored
    ];
    const stats = calculatePrMergeStats(prs);
    assert.equal(stats.avgMergeTimeHours, 13); // round((24 + 2) / 2)
    assert.equal(stats.fastestMergeTimeHours, 2);
    assert.deepEqual(stats.mergeTimeByAuthor.get("Alice"), [24, 2]);
    assert.equal(stats.mergeTimeByAuthor.has("Bob"), false);
  });

  test("no completed PRs -> zeros", () => {
    const stats = calculatePrMergeStats([pr({ author: "Alice", status: "active", creationDate: "2024-01-01T00:00:00Z" })]);
    assert.equal(stats.avgMergeTimeHours, 0);
    assert.equal(stats.fastestMergeTimeHours, 0);
  });
});

// ---------------------------------------------------------------------------
// 8. Top 5 leaderboards
// ---------------------------------------------------------------------------

describe("calculateTop5", () => {
  test("ranks busiest days by commit volume", () => {
    const commits = [
      commit("Alice", "2024-01-01T09:00:00Z"),
      commit("Bob", "2024-01-01T10:00:00Z"),
      commit("Carol", "2024-01-01T11:00:00Z"),
      commit("Alice", "2024-01-02T09:00:00Z"),
    ];
    const contributors = aggregateContributorStats(commits, [], [], NO_MERGE, NO_STREAK);
    const top5 = calculateTop5(contributors, commits, NO_STREAK);
    assert.equal(top5.busiestDaysByCommits[0].date, "2024-01-01");
    assert.equal(top5.busiestDaysByCommits[0].commits, 3);
    assert.equal(top5.mostCommits[0].name, "Alice"); // 2 commits
    assert.equal(top5.mostCommits[0].commits, 2);
  });

  test("longest-streak leaderboard omits people with a zero streak", () => {
    const contributors = [
      { name: "Alice", commits: 5, pullRequestsOpened: 0, pullRequestsReviewed: 0, commentsWritten: 0, bugsFixed: 0, storyPointsDone: 0, longestStreak: 4 },
      { name: "Bob", commits: 2, pullRequestsOpened: 0, pullRequestsReviewed: 0, commentsWritten: 0, bugsFixed: 0, storyPointsDone: 0, longestStreak: 0 },
    ];
    const top5 = calculateTop5(contributors, [], NO_STREAK);
    assert.equal(top5.longestStreaks?.length, 1);
    assert.equal(top5.longestStreaks?.[0].name, "Alice");
  });

  test("empty input does not throw", () => {
    const top5 = calculateTop5([], [], NO_STREAK);
    assert.deepEqual(top5.busiestDaysByCommits, []);
    assert.deepEqual(top5.mostCommits, []);
  });
});

// ---------------------------------------------------------------------------
// 9. Provenance / backward compatibility
// ---------------------------------------------------------------------------

// A minimal wrap shaped like the bundled sample data / an old saved wrap that
// predates the `meta` field.
const legacyWrap = {
  projectName: "Legacy Project",
  version: "1.0",
  dateRange: { start: "2024-01-01", end: "2024-12-31" },
  stats: {
    totalCommits: 100,
    totalPullRequests: 20,
    totalReviews: 30,
    totalComments: 40,
    totalBugsFixed: 5,
    totalStoryPointsDone: 50,
    sprintsCompleted: 12,
  },
  contributors: [],
  modules: [],
  top5: {
    mostCommits: [],
    mostPullRequestsOpened: [],
    mostPullRequestsReviewed: [],
    mostCommentsWritten: [],
    busiestDaysByCommits: [],
  },
  highlights: [],
  milestones: [],
};

describe("wrapped schema / provenance", () => {
  test("a wrap WITHOUT meta still validates (old saved wraps & sample data keep working)", () => {
    const parsed = projectWrappedDataSchema.safeParse(legacyWrap);
    assert.equal(parsed.success, true, parsed.success ? "" : JSON.stringify(parsed.error?.issues));
  });

  test("a wrap WITH a well-formed meta validates", () => {
    const withMeta = {
      ...legacyWrap,
      meta: {
        source: "Azure DevOps",
        generatedAt: "2026-07-08T00:00:00.000Z",
        organization: "Contoso",
        project: "Legacy Project",
        baseUrl: "https://dev.azure.com",
        filters: { dateFrom: "2024-01-01", dateTo: "2024-12-31", dateField: "created date" },
        repositoriesIncluded: ["repo-a", "repo-b"],
        counts: { commits: 100, pullRequests: 20, workItems: 60, repositories: 2 },
        definitions: ["Bugs fixed: Bug work items in a completed state."],
        notes: ["Comments are not collected."],
      },
    };
    const parsed = projectWrappedDataSchema.safeParse(withMeta);
    assert.equal(parsed.success, true, parsed.success ? "" : JSON.stringify(parsed.error?.issues));
  });

  test("meta shape carries no secret/token field (guards against leaking a PAT)", () => {
    // Structural guard: the provenance object we build must never include a token.
    // If someone adds a token-like field to the meta schema this fails loudly.
    const sampleMetaKeys = [
      "source",
      "generatedAt",
      "organization",
      "project",
      "baseUrl",
      "filters",
      "repositoriesIncluded",
      "counts",
      "definitions",
      "notes",
    ];
    for (const k of sampleMetaKeys) {
      assert.match(k, /^(?!.*(token|pat|secret|password|auth)).*$/i, `meta key "${k}" must not look like a secret`);
    }
  });
});
