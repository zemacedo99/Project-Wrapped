import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_CONFIG,
  CURRENT_CONFIG_VERSION,
  normalizeConfig,
  reconcileConfig,
  selectContributors,
  deriveTop5,
  applyConfig,
  applyIdentityAssociations,
  sortContributors,
  filterContributors,
  serializeConfig,
} from "./wrapped-config";

// --- fixtures ---------------------------------------------------------------

function contrib(name: string, over: Record<string, number> = {}) {
  return {
    name,
    commits: 0,
    pullRequestsOpened: 0,
    pullRequestsReviewed: 0,
    commentsWritten: 0,
    bugsFixed: 0,
    storyPointsDone: 0,
    ...over,
  };
}

const CONTRIBUTORS = [
  contrib("Alice", { commits: 100, pullRequestsOpened: 20, pullRequestsReviewed: 5, bugsFixed: 3, storyPointsDone: 40, longestStreak: 6 }),
  contrib("Bob", { commits: 60, pullRequestsOpened: 30, pullRequestsReviewed: 15, bugsFixed: 1, storyPointsDone: 10, longestStreak: 3 }),
  contrib("Carol", { commits: 10, pullRequestsOpened: 2, pullRequestsReviewed: 40, bugsFixed: 0, storyPointsDone: 0, longestStreak: 0 }),
];

function wrap(over: Record<string, unknown> = {}) {
  return {
    projectName: "Demo",
    version: "",
    dateRange: { start: "2024-01-01", end: "2024-12-31" },
    stats: {} as Record<string, number>,
    contributors: CONTRIBUTORS,
    modules: [],
    top5: {
      mostCommits: [{ name: "Alice", commits: 100 }],
      mostPullRequestsOpened: [],
      mostPullRequestsReviewed: [],
      mostCommentsWritten: [],
      busiestDaysByCommits: [{ date: "2024-03-01", commits: 12 }],
    },
    highlights: [],
    milestones: [],
    ...over,
  } as unknown as Parameters<typeof applyConfig>[0];
}

// --- config model / defaults ------------------------------------------------

describe("DEFAULT_CONFIG", () => {
  test("Story Points are hidden by default", () => {
    assert.equal(DEFAULT_CONFIG.showStoryPoints, false);
  });
  test("no filters are active by default", () => {
    assert.equal(DEFAULT_CONFIG.contributorSelection.mode, "all");
    assert.deepEqual(DEFAULT_CONFIG.repositories, []);
    assert.deepEqual(DEFAULT_CONFIG.hiddenSlides, []);
  });
});

describe("normalizeConfig", () => {
  test("undefined/null -> defaults, no warnings", () => {
    const a = normalizeConfig(undefined);
    assert.deepEqual(a.config, DEFAULT_CONFIG);
    assert.deepEqual(a.warnings, []);
    assert.deepEqual(normalizeConfig(null).config, DEFAULT_CONFIG);
  });

  test("Story Points default to off when unspecified", () => {
    assert.equal(normalizeConfig({}).config.showStoryPoints, false);
  });

  test("non-object input never throws and returns defaults", () => {
    for (const bad of ["nope", 42, true]) {
      const { config } = normalizeConfig(bad);
      assert.equal(config.showStoryPoints, false);
      assert.equal(config.configVersion, CURRENT_CONFIG_VERSION);
    }
  });

  test("a newer config version is accepted with a warning", () => {
    const { config, warnings } = normalizeConfig({ configVersion: 99, showStoryPoints: true });
    assert.equal(config.showStoryPoints, true);
    assert.ok(warnings.some(w => /newer/i.test(w)));
  });

  test("reads and coerces fields defensively", () => {
    const { config } = normalizeConfig({
      configVersion: 1,
      showStoryPoints: true,
      hiddenSlides: ["modules", 5, null], // non-strings dropped
      hiddenMetrics: "not-an-array", // wrong type -> []
      contributorSelection: { mode: "weird", names: [1, "Bob", 2] }, // bad mode -> all; non-strings dropped
      repositories: ["repo-a"],
    });
    assert.equal(config.showStoryPoints, true);
    assert.deepEqual(config.hiddenSlides, ["modules"]);
    assert.deepEqual(config.hiddenMetrics, []);
    assert.equal(config.contributorSelection.mode, "all");
    assert.deepEqual(config.contributorSelection.names, ["Bob"]);
    assert.deepEqual(config.repositories, ["repo-a"]);
  });
});

describe("serializeConfig", () => {
  test("round-trips through JSON + normalizeConfig", () => {
    const cfg = {
      configVersion: 1,
      showStoryPoints: true,
      hiddenMetrics: ["comments"],
      hiddenSlides: ["timeline"],
      contributorSelection: { mode: "include" as const, names: ["Alice"] },
      repositories: ["repo-a", "repo-b"],
      identityAssociations: [{ canonicalName: "Alice", aliasNames: ["alice-git"] }],
    };
    const restored = normalizeConfig(JSON.parse(serializeConfig(cfg))).config;
    assert.deepEqual(restored, cfg);
  });

  test("invalid JSON is the caller's concern; normalizeConfig handles the parsed value", () => {
    // Simulate the import path: JSON.parse throws on invalid text and never reaches normalizeConfig.
    assert.throws(() => JSON.parse("{ not valid json"));
  });
});

describe("reconcileConfig", () => {
  test("drops unknown repositories and contributors, with warnings", () => {
    const cfg = {
      ...DEFAULT_CONFIG,
      repositories: ["repo-a", "ghost-repo"],
      contributorSelection: { mode: "include" as const, names: ["Alice", "Nobody"] },
    };
    const { config, warnings } = reconcileConfig(cfg, {
      repoNames: ["repo-a", "repo-b"],
      contributorNames: ["Alice", "Bob"],
    });
    assert.deepEqual(config.repositories, ["repo-a"]);
    assert.deepEqual(config.contributorSelection.names, ["Alice"]);
    assert.equal(warnings.length, 2);
    assert.ok(warnings.some(w => /repositor/i.test(w)));
    assert.ok(warnings.some(w => /contributor/i.test(w)));
  });

  test("no warnings when everything matches", () => {
    const cfg = { ...DEFAULT_CONFIG, contributorSelection: { mode: "exclude" as const, names: ["Bob"] } };
    const { warnings } = reconcileConfig(cfg, { repoNames: [], contributorNames: ["Alice", "Bob"] });
    assert.deepEqual(warnings, []);
  });

  test("drops identity associations that reference unknown people, keeping valid aliases", () => {
    const cfg = {
      ...DEFAULT_CONFIG,
      identityAssociations: [
        { canonicalName: "Alice", aliasNames: ["alice-git", "ghost"] },
        { canonicalName: "Ghost", aliasNames: ["x"] },
      ],
    };
    const { config, warnings } = reconcileConfig(cfg, {
      repoNames: [],
      contributorNames: ["Alice", "alice-git"],
    });
    assert.equal(config.identityAssociations.length, 1);
    assert.deepEqual(config.identityAssociations[0], { canonicalName: "Alice", aliasNames: ["alice-git"] });
    assert.ok(warnings.some(w => /identity association/i.test(w)));
  });
});

// --- contributor filtering --------------------------------------------------

describe("selectContributors", () => {
  test("mode 'all' returns everyone", () => {
    assert.equal(selectContributors(CONTRIBUTORS, { mode: "all", names: ["Alice"] }).length, 3);
  });
  test("mode 'include' keeps only selected", () => {
    const r = selectContributors(CONTRIBUTORS, { mode: "include", names: ["Alice", "Carol"] });
    assert.deepEqual(r.map(c => c.name), ["Alice", "Carol"]);
  });
  test("mode 'exclude' removes selected", () => {
    const r = selectContributors(CONTRIBUTORS, { mode: "exclude", names: ["Alice"] });
    assert.deepEqual(r.map(c => c.name), ["Bob", "Carol"]);
  });
  test("include with empty selection falls back to everyone (never an empty recap)", () => {
    assert.equal(selectContributors(CONTRIBUTORS, { mode: "include", names: [] }).length, 3);
  });
});

describe("applyConfig", () => {
  test("default config leaves data untouched (zero behavior change) but reports story points off", () => {
    const d = applyConfig(wrap(), DEFAULT_CONFIG);
    assert.equal(d.contributors.length, 3);
    assert.equal(d.contributorFilterActive, false);
    assert.equal(d.showStoryPoints, false);
    // top5 is passed through unchanged when no contributor filter is active
    assert.deepEqual(d.top5.mostCommits, [{ name: "Alice", commits: 100 }]);
  });

  test("contributor filter recomputes the people set and rebuilds leaderboards", () => {
    const cfg = { ...DEFAULT_CONFIG, contributorSelection: { mode: "exclude" as const, names: ["Alice"] } };
    const d = applyConfig(wrap(), cfg);
    assert.equal(d.contributorFilterActive, true);
    assert.deepEqual(d.contributors.map(c => c.name), ["Bob", "Carol"]);
    // Alice was the commits leader; after excluding her, Bob leads the rebuilt board.
    assert.equal(d.top5.mostCommits[0].name, "Bob");
    // busiest days (not contributor-derived) are preserved.
    assert.deepEqual(d.top5.busiestDaysByCommits, [{ date: "2024-03-01", commits: 12 }]);
  });

  test("showStoryPoints flag flows through", () => {
    const d = applyConfig(wrap(), { ...DEFAULT_CONFIG, showStoryPoints: true });
    assert.equal(d.showStoryPoints, true);
  });
});

describe("deriveTop5", () => {
  test("ranks by each metric and drops zero values", () => {
    const t = deriveTop5(CONTRIBUTORS, []);
    assert.deepEqual(t.mostCommits.map(c => c.name), ["Alice", "Bob", "Carol"]);
    assert.equal(t.mostPullRequestsReviewed[0].name, "Carol");
    // Carol has a 0 streak and must be excluded from the streak board.
    assert.deepEqual((t.longestStreaks ?? []).map(c => c.name), ["Alice", "Bob"]);
  });
});

// --- manual identity association (client layer) -----------------------------

describe("applyIdentityAssociations", () => {
  const rows = [
    contrib("José Macedo", { commits: 823, pullRequestsOpened: 40, pullRequestsReviewed: 12 }),
    contrib("jamacedo", { commits: 1079 }),
    contrib("jm-personal", { commits: 3 }),
    contrib("Someone Else", { commits: 200 }),
  ];
  const assoc = [{ canonicalName: "José Macedo", aliasNames: ["jamacedo", "jm-personal"] }];

  test("merges confirmed aliases into the canonical person and sums commits", () => {
    const merged = applyIdentityAssociations(rows, assoc);
    assert.equal(merged.length, 2, "3 identities collapse to 1, plus the unrelated person");
    const jose = merged.find(c => c.name === "José Macedo")!;
    assert.equal(jose.commits, 1905, "823 + 1079 + 3");
    assert.equal(jose.pullRequestsOpened, 40, "canonical's own PRs preserved");
    assert.ok((jose.aliases?.length ?? 0) >= 3, "aliases recorded for the details view");
  });

  test("no duplicate rows remain after association", () => {
    const merged = applyIdentityAssociations(rows, assoc);
    const names = merged.map(c => c.name);
    assert.equal(new Set(names).size, names.length);
    assert.equal(names.includes("jamacedo"), false);
    assert.equal(names.includes("jm-personal"), false);
  });

  test("Commit Champion and Top Contributors use the SAME canonical count", () => {
    const merged = applyIdentityAssociations(rows, assoc);
    // Mimic ChampionsSlide.findChampion(contributors, "commits").
    const champion = merged.reduce((p, c) => (c.commits > p.commits ? c : p), merged[0]);
    const top1 = deriveTop5(merged, []).mostCommits[0];
    assert.equal(champion.name, top1.name);
    assert.equal(champion.commits, top1.commits);
    assert.equal(champion.commits, 1905, "no 5.9k-vs-1079 mismatch: one canonical total everywhere");
  });

  test("empty associations return the input untouched", () => {
    assert.equal(applyIdentityAssociations(rows, []), rows);
  });
});

// --- selector helpers -------------------------------------------------------

describe("sort / filter helpers", () => {
  test("sortContributors by commits (desc) and name (asc)", () => {
    assert.deepEqual(sortContributors(CONTRIBUTORS, "commits").map(c => c.name), ["Alice", "Bob", "Carol"]);
    assert.deepEqual(sortContributors(CONTRIBUTORS, "name").map(c => c.name), ["Alice", "Bob", "Carol"]);
  });
  test("filterContributors by search and activity", () => {
    assert.deepEqual(filterContributors(CONTRIBUTORS, "all", "car").map(c => c.name), ["Carol"]);
    assert.deepEqual(filterContributors(CONTRIBUTORS, "reviews", "").map(c => c.name), ["Alice", "Bob", "Carol"]);
    // Carol has no bugs and no story points -> excluded from "workItems".
    assert.deepEqual(filterContributors(CONTRIBUTORS, "workItems", "").map(c => c.name), ["Alice", "Bob"]);
  });
});
