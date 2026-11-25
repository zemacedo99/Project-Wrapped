import { test, describe } from "node:test";
import assert from "node:assert/strict";

import type { Contributor, ProjectWrappedData } from "@shared/schema";
import { armyFactions, buildPosterPrompt, championTitles, compactNumber, posterSubtitleStats } from "./poster-prompt";

function person(name: string, over: Partial<Contributor> = {}): Contributor {
  return {
    name,
    commits: 0,
    pullRequestsOpened: 0,
    pullRequestsReviewed: 0,
    commentsWritten: 0,
    bugsFixed: 0,
    storyPointsDone: 0,
    ...over,
  } as Contributor;
}

function recap(over: Partial<ProjectWrappedData> = {}): ProjectWrappedData {
  return {
    projectName: "RADuxtion",
    version: "",
    dateRange: { start: "2026-06-28", end: "2026-11-25" },
    stats: {
      totalCommits: 11851,
      totalPullRequests: 2037,
      totalReviews: 2203,
      totalComments: 0,
      totalBugsFixed: 193,
      totalStoryPointsDone: 0,
      sprintsCompleted: 1,
      totalWorkItems: 3464,
    },
    contributors: [],
    modules: [],
    top5: {} as ProjectWrappedData["top5"],
    highlights: [],
    milestones: [],
    workItemBreakdown: { Bug: 224, Task: 921, "Test Case": 1051, Requirement: 536, "Change Request": 409, Risk: 56 },
    meta: { source: "Azure DevOps" } as ProjectWrappedData["meta"],
    ...over,
  } as ProjectWrappedData;
}

const eduardo = person("Eduardo Aires", { commits: 6658, pullRequestsReviewed: 691, bugsResolved: 161, bugsValidated: 3 });
const ana = person("Ana Dias", { commits: 681, pullRequestsReviewed: 2, bugsResolved: 18 });

describe("compactNumber", () => {
  test("matches the recap's number style", () => {
    assert.equal(compactNumber(691), "691");
    assert.equal(compactNumber(6658), "6.7K");
    assert.equal(compactNumber(11851), "11.9K");
  });
});

describe("championTitles", () => {
  test("gives each Hall of Fame title to its leader, skipping zero titles", () => {
    const titles = championTitles([ana, eduardo]);
    assert.deepEqual(
      titles.map((t) => `${t.title}: ${t.holder} (${t.achievement})`),
      [
        "Review Champion: Eduardo Aires (691 PRs reviewed)",
        "Commit Champion: Eduardo Aires (6.7K commits)",
        "Bug Slayer: Eduardo Aires (161 bugs resolved)",
        "Validation Hero: Eduardo Aires (3 bugs validated)",
      ]
    );
  });

  test("uses singular wording for one", () => {
    const [validation] = championTitles([person("Solo", { bugsValidated: 1 })]).filter((t) => t.title === "Validation Hero");
    assert.equal(validation.achievement, "1 bug validated");
  });

  test("no contributors, no titles", () => {
    assert.deepEqual(championTitles([]), []);
  });
});

describe("armyFactions", () => {
  test("takes the most common work-item types plus PRs, each a distinct colour", () => {
    const factions = armyFactions(recap());
    assert.deepEqual(factions.map((f) => `${f.colour} ${f.name}`), [
      "Blue Pull Requests",
      "Green Test Cases",
      "Yellow Tasks",
      "Purple Requirements",
      "Orange Change Requests",
      "Red Bugs",
    ]);
  });

  test("unknown types get spare colours without repeating", () => {
    const factions = armyFactions(recap({ workItemBreakdown: { Gizmo: 5, Widget: 3 }, stats: { ...recap().stats, totalPullRequests: 0 } }));
    assert.deepEqual(factions.map((f) => f.colour), ["Brown", "Pink"]);
    assert.deepEqual(factions.map((f) => f.name), ["Gizmos", "Widgets"]);
  });
});

describe("posterSubtitleStats", () => {
  test("formats the project totals", () => {
    assert.equal(posterSubtitleStats(recap()), "11.9K commits · 2,037 PRs · 3,464 work items");
  });
});

describe("buildPosterPrompt", () => {
  test("one person with every title gets the ONE-MAN ARMY poster", () => {
    const prompt = buildPosterPrompt(recap(), [eduardo, ana])!;
    assert.match(prompt, /titled "ONE-MAN ARMY"/);
    assert.match(prompt, /A lone software developer named Eduardo Aires/);
    assert.match(prompt, /The Four Rings of Power/);
    assert.match(prompt, /exact captions:\n\* "Review Champion – 691 PRs reviewed"/); // captions follow directly
    assert.ok(prompt.includes('* "Commit Champion – 6.7K commits"'));
    assert.ok(prompt.includes('"Eduardo Aires vs. the RADuxtion project – 11.9K commits · 2,037 PRs · 3,464 work items"'));
    assert.match(prompt, /glowing Azure DevOps logo/);
    assert.match(prompt, /Eduardo Aires must be the only human character/);
  });

  test("titles spread across people become a fellowship naming each holder", () => {
    const bruno = person("Bruno Aguiam", { pullRequestsReviewed: 900 });
    const prompt = buildPosterPrompt(recap(), [eduardo, bruno])!;
    assert.match(prompt, /titled "TWO AGAINST THE HORDE"/);
    assert.match(prompt, /Eduardo Aires and Bruno Aguiam/);
    assert.ok(prompt.includes('* "Review Champion – 900 PRs reviewed" (worn by Bruno Aguiam; deep blue sapphire)'));
    assert.ok(!prompt.includes("No teammates"));
  });

  test("three or more holders get THE FELLOWSHIP", () => {
    const prompt = buildPosterPrompt(recap(), [
      person("A", { commits: 10 }),
      person("B", { pullRequestsReviewed: 5 }),
      person("C", { bugsResolved: 2 }),
    ])!;
    assert.match(prompt, /titled "THE FELLOWSHIP"/);
    assert.match(prompt, /B, A and C/); // one title each: Hall of Fame order (review, commit, bugs)
    assert.match(prompt, /The Three Rings of Power/);
  });

  test("nothing to celebrate, no prompt", () => {
    assert.equal(buildPosterPrompt(recap(), []), null);
  });
});
