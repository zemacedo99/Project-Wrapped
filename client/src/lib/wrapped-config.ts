import type { ProjectWrappedData, Contributor, ContributorAlias, Top5, WrappedConfig } from "@shared/schema";

// Bump when the config shape changes in a way that needs migration.
export const CURRENT_CONFIG_VERSION = 1;

export const DEFAULT_CONFIG: WrappedConfig = {
  configVersion: CURRENT_CONFIG_VERSION,
  showStoryPoints: false, // hidden by default (this project doesn't use story points)
  hiddenMetrics: [],
  hiddenSlides: [],
  contributorSelection: { mode: "all", names: [] },
  repositories: [],
  identityAssociations: [],
};

// Stat-card ids that can be hidden on "The Numbers" slide.
export const METRIC_IDS = [
  "commits",
  "pullRequests",
  "reviews",
  "comments",
  "filesChanged",
  "repositories",
  "longestStreak",
  "avgPrMergeTime",
  "workItems",
  "storyPoints",
] as const;

// Slide ids that can be hidden. Intro and outro are always shown.
export const HIDEABLE_SLIDES = [
  { id: "champions", label: "Hall of Fame" },
  { id: "contributors", label: "The Team" },
  { id: "top5", label: "Top Contributors" },
  { id: "modules", label: "Work Areas" },
  { id: "timeline", label: "The Journey" },
  { id: "highlights", label: "Highlights" },
] as const;

export type ContribSort = "name" | "commits" | "prs" | "reviews" | "bugs" | "storyPoints";
export type ContribFilter = "all" | "commits" | "prs" | "reviews" | "workItems";

function asStringArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

/**
 * Defensively turn arbitrary parsed JSON into a valid config. Never throws:
 * unknown/missing fields fall back to defaults, and newer/older versions are
 * accepted with a warning rather than rejected.
 */
export function normalizeConfig(raw: unknown): { config: WrappedConfig; warnings: string[] } {
  const warnings: string[] = [];

  if (raw === null || raw === undefined) {
    return { config: { ...DEFAULT_CONFIG }, warnings };
  }
  if (typeof raw !== "object") {
    return { config: { ...DEFAULT_CONFIG }, warnings: ["Configuration was not a JSON object; defaults were used."] };
  }

  const r = raw as Record<string, unknown>;

  const version = typeof r.configVersion === "number" ? r.configVersion : undefined;
  if (version === undefined) {
    warnings.push("Configuration had no version; assuming version 1.");
  } else if (version > CURRENT_CONFIG_VERSION) {
    warnings.push(
      `Configuration version ${version} is newer than this app supports (${CURRENT_CONFIG_VERSION}); unrecognized options were ignored.`
    );
  }

  const selRaw =
    r.contributorSelection && typeof r.contributorSelection === "object"
      ? (r.contributorSelection as Record<string, unknown>)
      : {};
  const mode =
    selRaw.mode === "include" || selRaw.mode === "exclude" || selRaw.mode === "all"
      ? (selRaw.mode as WrappedConfig["contributorSelection"]["mode"])
      : "all";

  const associationsRaw = Array.isArray(r.identityAssociations) ? r.identityAssociations : [];
  const identityAssociations = associationsRaw
    .map((a): WrappedConfig["identityAssociations"][number] | null => {
      if (!a || typeof a !== "object") return null;
      const rec = a as Record<string, unknown>;
      if (typeof rec.canonicalName !== "string") return null;
      return { canonicalName: rec.canonicalName, aliasNames: asStringArray(rec.aliasNames) };
    })
    .filter((a): a is WrappedConfig["identityAssociations"][number] => a !== null);

  const config: WrappedConfig = {
    configVersion: CURRENT_CONFIG_VERSION,
    showStoryPoints: typeof r.showStoryPoints === "boolean" ? r.showStoryPoints : false,
    hiddenMetrics: asStringArray(r.hiddenMetrics),
    hiddenSlides: asStringArray(r.hiddenSlides),
    contributorSelection: { mode, names: asStringArray(selRaw.names) },
    repositories: asStringArray(r.repositories),
    identityAssociations,
  };

  return { config, warnings };
}

/**
 * Drop repositories/contributors that don't exist in this recap and warn, so a
 * config reused from another project applies its valid parts and ignores the rest.
 */
export function reconcileConfig(
  config: WrappedConfig,
  known: { repoNames: string[]; contributorNames: string[] }
): { config: WrappedConfig; warnings: string[] } {
  const warnings: string[] = [];
  const repoSet = new Set(known.repoNames);
  const contribSet = new Set(known.contributorNames);

  const keptRepos = config.repositories.filter(n => repoSet.has(n));
  if (keptRepos.length !== config.repositories.length) {
    warnings.push(
      `${config.repositories.length - keptRepos.length} repository(ies) from the configuration are not in this recap and were ignored.`
    );
  }

  const keptNames = config.contributorSelection.names.filter(n => contribSet.has(n));
  if (keptNames.length !== config.contributorSelection.names.length) {
    warnings.push(
      `${config.contributorSelection.names.length - keptNames.length} contributor(s) from the configuration are not in this recap and were ignored.`
    );
  }

  // Keep only associations whose canonical exists; within each, keep known aliases.
  let droppedAssoc = 0;
  const keptAssociations = config.identityAssociations
    .map(a => ({ canonicalName: a.canonicalName, aliasNames: a.aliasNames.filter(n => contribSet.has(n)) }))
    .filter(a => {
      const ok = contribSet.has(a.canonicalName) && a.aliasNames.length > 0;
      if (!ok) droppedAssoc++;
      return ok;
    });
  if (droppedAssoc > 0) {
    warnings.push(`${droppedAssoc} identity association(s) referenced people not in this recap and were ignored.`);
  }

  return {
    config: {
      ...config,
      repositories: keptRepos,
      contributorSelection: { ...config.contributorSelection, names: keptNames },
      identityAssociations: keptAssociations,
    },
    warnings,
  };
}

/**
 * Merge user-confirmed alias contributors into their canonical contributor,
 * summing metrics and combining alias lists. Runs on top of the server's
 * automatic (email / exact-name) canonicalization.
 */
export function applyIdentityAssociations(
  contributors: Contributor[],
  associations: WrappedConfig["identityAssociations"]
): Contributor[] {
  if (!associations || associations.length === 0) return contributors;

  const byName = new Map(contributors.map(c => [c.name, c]));
  const consumed = new Set<string>();
  const merged: Contributor[] = [];

  for (const assoc of associations) {
    const canonical = byName.get(assoc.canonicalName);
    if (!canonical || consumed.has(canonical.name)) continue;
    const aliasRows = assoc.aliasNames
      .map(n => byName.get(n))
      .filter((c): c is Contributor => !!c && c.name !== canonical.name && !consumed.has(c.name));
    if (aliasRows.length === 0) continue;

    merged.push(mergeCanonical(canonical, aliasRows));
    consumed.add(canonical.name);
    for (const a of aliasRows) consumed.add(a.name);
  }

  const result = [...merged, ...contributors.filter(c => !consumed.has(c.name))];
  return result.sort((a, b) => b.commits - a.commits);
}

// Merge alias rows into a canonical contributor, keeping the canonical identity
// as the label and summing all metrics.
function mergeCanonical(canonical: Contributor, aliases: Contributor[]): Contributor {
  const all = [canonical, ...aliases];
  const sum = (k: keyof Contributor) => all.reduce((n, m) => n + ((m[k] as number) || 0), 0);
  const aliasList: ContributorAlias[] = [
    ...(canonical.aliases ?? [{ name: canonical.name, email: canonical.email ?? canonical.uniqueName, source: canonical.source === "git" ? "git" : "azure", commits: canonical.commits } as ContributorAlias]),
    ...aliases.flatMap(
      a =>
        a.aliases ?? [
          { name: a.name, email: a.email ?? a.uniqueName, source: a.source === "git" ? "git" : "azure", commits: a.commits } as ContributorAlias,
        ]
    ),
  ];

  return {
    ...canonical,
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
    longestStreak: Math.max(...all.map(m => m.longestStreak || 0)),
    source: "mixed",
    aliases: aliasList,
  };
}

/** Apply the contributor include/exclude selection. */
export function selectContributors(
  contributors: Contributor[],
  sel: WrappedConfig["contributorSelection"]
): Contributor[] {
  // "include" with an empty selection is treated as "show all" to avoid an empty recap.
  if (sel.mode === "all" || sel.names.length === 0) return contributors;
  const set = new Set(sel.names);
  return sel.mode === "include"
    ? contributors.filter(c => set.has(c.name))
    : contributors.filter(c => !set.has(c.name));
}

/** Rebuild the leaderboards from a (possibly filtered) contributor set. */
export function deriveTop5(contributors: Contributor[], busiestDays: Top5["busiestDaysByCommits"]): Top5 {
  const topBy = <K extends keyof Contributor>(key: K) =>
    [...contributors]
      .filter(c => ((c[key] as number) || 0) > 0)
      .sort((a, b) => ((b[key] as number) || 0) - ((a[key] as number) || 0))
      .slice(0, 5);

  return {
    mostCommits: topBy("commits").map(c => ({ name: c.name, commits: c.commits })),
    mostPullRequestsOpened: topBy("pullRequestsOpened").map(c => ({
      name: c.name,
      pullRequestsOpened: c.pullRequestsOpened,
    })),
    mostPullRequestsReviewed: topBy("pullRequestsReviewed").map(c => ({
      name: c.name,
      pullRequestsReviewed: c.pullRequestsReviewed,
    })),
    mostCommentsWritten: topBy("commentsWritten").map(c => ({
      name: c.name,
      commentsWritten: c.commentsWritten,
    })),
    busiestDaysByCommits: busiestDays,
    longestStreaks: [...contributors]
      .filter(c => (c.longestStreak || 0) > 0)
      .sort((a, b) => (b.longestStreak || 0) - (a.longestStreak || 0))
      .slice(0, 5)
      .map(c => ({ name: c.name, commits: c.longestStreak || 0 })),
  };
}

export interface DerivedWrapped {
  contributors: Contributor[];
  top5: Top5;
  showStoryPoints: boolean;
  hiddenMetrics: Set<string>;
  hiddenSlides: Set<string>;
  contributorFilterActive: boolean;
}

/**
 * Produce the view the recap should render for a given config. When no contributor
 * filter is active this returns the original data untouched (zero behavior change),
 * so unconfigured wraps look exactly as before.
 */
export function applyConfig(data: ProjectWrappedData, config: WrappedConfig): DerivedWrapped {
  const associationsActive = (config.identityAssociations?.length ?? 0) > 0;
  // 1) Apply user-confirmed identity merges (on top of server auto-canonicalization).
  const canonical = associationsActive
    ? applyIdentityAssociations(data.contributors, config.identityAssociations)
    : data.contributors;

  // 2) Apply the contributor include/exclude selection.
  const contributorFilterActive =
    config.contributorSelection.mode !== "all" && config.contributorSelection.names.length > 0;
  const contributors = contributorFilterActive
    ? selectContributors(canonical, config.contributorSelection)
    : canonical;

  // Rebuild leaderboards from the same canonical, filtered set whenever it changed,
  // so Champions / Top 5 / Team all agree.
  const changed = associationsActive || contributorFilterActive;
  const top5 = changed ? deriveTop5(contributors, data.top5?.busiestDaysByCommits ?? []) : data.top5;

  return {
    contributors,
    top5,
    showStoryPoints: config.showStoryPoints,
    hiddenMetrics: new Set(config.hiddenMetrics),
    hiddenSlides: new Set(config.hiddenSlides),
    contributorFilterActive,
  };
}

// --- selector helpers (used by the Settings contributor picker) -------------

export function sortContributors(list: Contributor[], sort: ContribSort): Contributor[] {
  const copy = [...list];
  switch (sort) {
    case "name":
      return copy.sort((a, b) => a.name.localeCompare(b.name));
    case "commits":
      return copy.sort((a, b) => b.commits - a.commits);
    case "prs":
      return copy.sort((a, b) => b.pullRequestsOpened - a.pullRequestsOpened);
    case "reviews":
      return copy.sort((a, b) => b.pullRequestsReviewed - a.pullRequestsReviewed);
    case "bugs":
      return copy.sort((a, b) => b.bugsFixed - a.bugsFixed);
    case "storyPoints":
      return copy.sort((a, b) => b.storyPointsDone - a.storyPointsDone);
    default:
      return copy;
  }
}

export function filterContributors(
  list: Contributor[],
  filter: ContribFilter,
  search: string
): Contributor[] {
  const q = search.trim().toLowerCase();
  return list.filter(c => {
    if (q && !c.name.toLowerCase().includes(q)) return false;
    switch (filter) {
      case "commits":
        return c.commits > 0;
      case "prs":
        return c.pullRequestsOpened > 0;
      case "reviews":
        return c.pullRequestsReviewed > 0;
      case "workItems":
        return c.bugsFixed > 0 || c.storyPointsDone > 0;
      default:
        return true;
    }
  });
}

/** Serialize a config for download (stable key order, pretty-printed). */
export function serializeConfig(config: WrappedConfig): string {
  return JSON.stringify(
    {
      configVersion: config.configVersion,
      showStoryPoints: config.showStoryPoints,
      hiddenMetrics: config.hiddenMetrics,
      hiddenSlides: config.hiddenSlides,
      contributorSelection: config.contributorSelection,
      repositories: config.repositories,
      identityAssociations: config.identityAssociations,
    },
    null,
    2
  );
}
