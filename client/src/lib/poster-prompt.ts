// Builds a text-to-image prompt for a fantasy "movie poster" of the recap's
// champions: whoever holds the Hall of Fame titles in *this* project, the
// project's own work-item types as the enemy army, and its real totals.
import type { Contributor, ProjectWrappedData } from "@shared/schema";

/** The contributor with the highest value for `key` (first one wins ties). */
export function findChampion(contributors: Contributor[], key: keyof Contributor): Contributor | undefined {
  return contributors.reduce<Contributor | undefined>((prev, current) => {
    if (!prev) return current;
    const prevValue = (prev[key] as number) || 0;
    const currentValue = (current[key] as number) || 0;
    return currentValue > prevValue ? current : prev;
  }, undefined);
}

export function compactNumber(num: number): string {
  if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(1)}M`;
  if (num >= 1000) return `${(num / 1000).toFixed(1)}K`;
  return num.toLocaleString("en-US");
}

function plural(n: number, one: string, many: string): string {
  return `${compactNumber(n)} ${n === 1 ? one : many}`;
}

export interface ChampionTitle {
  title: string;
  holder: string;
  /** e.g. "691 PRs reviewed" */
  achievement: string;
  gemstone: string;
}

// Same titles and rules as the Hall of Fame slide.
export function championTitles(contributors: Contributor[]): ChampionTitle[] {
  if (contributors.length === 0) return [];
  const titles: ChampionTitle[] = [];

  const review = findChampion(contributors, "pullRequestsReviewed");
  if (review && review.pullRequestsReviewed > 0) {
    titles.push({
      title: "Review Champion",
      holder: review.name,
      achievement: plural(review.pullRequestsReviewed, "PR reviewed", "PRs reviewed"),
      gemstone: "deep blue sapphire",
    });
  }
  const comments = findChampion(contributors, "commentsWritten");
  if (comments && comments.commentsWritten > 0) {
    titles.push({
      title: "Comments Champion",
      holder: comments.name,
      achievement: plural(comments.commentsWritten, "comment written", "comments written"),
      gemstone: "violet amethyst",
    });
  }
  const commits = findChampion(contributors, "commits");
  if (commits && commits.commits > 0) {
    titles.push({
      title: "Commit Champion",
      holder: commits.name,
      achievement: plural(commits.commits, "commit", "commits"),
      gemstone: "black onyx",
    });
  }
  const slayer = findChampion(contributors, "bugsResolved");
  if (slayer && (slayer.bugsResolved ?? 0) > 0) {
    titles.push({
      title: "Bug Slayer",
      holder: slayer.name,
      achievement: plural(slayer.bugsResolved ?? 0, "bug resolved", "bugs resolved"),
      gemstone: "blood-red ruby",
    });
  }
  const validator = findChampion(contributors, "bugsValidated");
  if (validator && (validator.bugsValidated ?? 0) > 0) {
    titles.push({
      title: "Validation Hero",
      holder: validator.name,
      achievement: plural(validator.bugsValidated ?? 0, "bug validated", "bugs validated"),
      gemstone: "green emerald",
    });
  }
  return titles;
}

const FACTION_COLOURS: Record<string, string> = {
  bug: "Red",
  task: "Yellow",
  "test case": "Green",
  "pull request": "Blue",
  requirement: "Purple",
  "change request": "Orange",
  "user story": "Teal",
  feature: "Silver",
  epic: "Black",
  issue: "Crimson",
  risk: "Grey",
  architecture: "Bronze",
  design: "White",
};
const SPARE_COLOURS = ["Brown", "Pink", "Cyan", "Ivory", "Olive", "Navy"];

function pluralType(type: string): string {
  if (/(s|x|ch|sh)$/i.test(type)) return `${type}es`;
  if (/[^aeiou]y$/i.test(type)) return `${type.slice(0, -1)}ies`;
  return `${type}s`;
}

/**
 * Up to `max` enemy factions: the project's most common work-item types plus
 * pull requests, each with its own colour.
 */
export function armyFactions(data: ProjectWrappedData, max = 6): Array<{ colour: string; name: string }> {
  const counts: Array<[string, number]> = Object.entries(data.workItemBreakdown ?? {}).filter(([, n]) => n > 0);
  if (data.stats.totalPullRequests > 0) counts.push(["Pull Request", data.stats.totalPullRequests]);
  counts.sort((a, b) => b[1] - a[1]);

  const used = new Set<string>();
  const spare = [...SPARE_COLOURS];
  return counts.slice(0, max).map(([type]) => {
    let colour = FACTION_COLOURS[type.toLowerCase()];
    if (!colour || used.has(colour)) colour = spare.shift() ?? "Grey";
    used.add(colour);
    return { colour, name: pluralType(type) };
  });
}

function listNames(names: string[]): string {
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

const NUMBER_WORDS = ["Zero", "One", "Two", "Three", "Four", "Five", "Six"];

export function posterSubtitleStats(data: ProjectWrappedData): string {
  const s = data.stats;
  const parts: string[] = [];
  if (s.totalCommits > 0) parts.push(plural(s.totalCommits, "commit", "commits"));
  if (s.totalPullRequests > 0) parts.push(`${s.totalPullRequests.toLocaleString("en-US")} ${s.totalPullRequests === 1 ? "PR" : "PRs"}`);
  const workItems = s.totalWorkItems ?? 0;
  if (workItems > 0) parts.push(`${workItems.toLocaleString("en-US")} ${workItems === 1 ? "work item" : "work items"}`);
  return parts.join(" · ");
}

function platformName(data: ProjectWrappedData): string {
  const source = data.meta?.source ?? "";
  if (/azure/i.test(source)) return "Azure DevOps";
  if (/github/i.test(source)) return "GitHub";
  return "";
}

/**
 * The full poster prompt, or null when there is no champion to put on it.
 * `contributors` should be the list currently shown (after settings/filters).
 */
export function buildPosterPrompt(data: ProjectWrappedData, contributors: Contributor[]): string | null {
  const titles = championTitles(contributors);
  if (titles.length === 0) return null;

  // Whoever holds the most titles leads; ties keep Hall of Fame order.
  const titleCount = new Map<string, number>();
  for (const t of titles) titleCount.set(t.holder, (titleCount.get(t.holder) ?? 0) + 1);
  const holders = Array.from(titleCount.keys()).sort((a, b) => titleCount.get(b)! - titleCount.get(a)!);
  const solo = holders.length === 1;
  const project = data.projectName.trim() || "the project";
  const platform = platformName(data);
  const itemWord = platform ? `${platform} work items` : "software work items";
  const posterTitle = solo ? "ONE-MAN ARMY" : holders.length === 2 ? "TWO AGAINST THE HORDE" : "THE FELLOWSHIP";
  const ringCount = NUMBER_WORDS[titles.length] ?? String(titles.length);
  const ringWord = titles.length === 1 ? "Ring" : "Rings";
  const stats = posterSubtitleStats(data);
  const subtitle = `${solo ? holders[0] : listNames(holders)} vs. the ${project} project${stats ? ` – ${stats}` : ""}`;
  const factions = armyFactions(data);

  const hero = solo
    ? `A lone software developer named ${holders[0]} stands heroically on a rocky hill, facing an enormous army of thousands of orcs stretching to the horizon. They wear weathered medieval leather armour and a flowing dark burgundy cape, wielding a glowing mechanical keyboard like a legendary enchanted sword.`
    : `A small fellowship of ${holders.length} software developers – ${listNames(holders)} – stand shoulder to shoulder on a rocky hill, facing an enormous army of thousands of orcs stretching to the horizon. They wear weathered medieval leather armour and flowing dark capes, each wielding a glowing mechanical keyboard like a legendary enchanted sword.`;

  const rings = titles
    .map((t) => `* "${t.title} – ${t.achievement}"${solo ? "" : ` (worn by ${t.holder}; ${t.gemstone})`}`)
    .join("\n");
  const gemNote = solo ? ` Gemstones: ${titles.map((t) => `${t.title} – ${t.gemstone}`).join("; ")}.` : "";
  const ringIntro = solo
    ? `${holders[0]} wears ${ringCount.toLowerCase()} ornate golden ${ringWord.toLowerCase()} on the free hand, each representing one legendary achievement.`
    : `Each hero wears ornate golden rings for the titles they hold.`;

  const characters = solo
    ? `${holders[0]} must be the only human character.`
    : `${listNames(holders)} must be the only human characters.`;

  return [
    `Create an epic, photorealistic cinematic movie poster titled "${posterTitle}", inspired by the atmosphere, cinematography and medieval dark fantasy aesthetic of The Lord of the Rings.`,
    "",
    "Scene:",
    hero,
    "",
    `The orc army represents ${itemWord}, divided into ${factions.length > 0 ? `${factions.length} factions` : "factions"} distinguished by their armour, war banners and symbols:`,
    ...(factions.length > 0 ? factions.map((f) => `* ${f.colour} — ${f.name}`) : ["* Bugs, tasks and pull requests"]),
    "",
    `In the distance, a monumental dark fortress bears the glowing ${platform ? `${platform} logo` : "emblem of the project"}, reminiscent of Mordor.`,
    "",
    `The ${ringCount} ${ringWord} of Power:`,
    `${ringIntro}${gemNote} Showcase ${titles.length === 1 ? "the ring" : `these ${ringCount.toLowerCase()} rings individually`} near the bottom of the poster, with intricate engravings, coloured gemstones and the following exact captions:`,
    rings,
    "",
    "Movie poster typography:",
    "At the bottom, display a monumental golden medieval serif title:",
    `"${posterTitle}"`,
    "Immediately below, in smaller elegant lettering:",
    `"${subtitle}"`,
    "",
    "Art direction:",
    "* Photorealistic, live-action dark fantasy cinematography.",
    "* The Lord of the Rings atmosphere, particularly the battles of Helm's Deep and Mordor.",
    "* Dramatic mountainous landscape, battlefield fog, burning embers and stormy skies.",
    "* Deep purple, burgundy, charcoal and muted golden tones.",
    "* Realistic textures, weathered armour and natural cinematic lighting.",
    `* Epic sense of scale, with ${solo ? `${holders[0]} standing alone` : "the fellowship standing"} against overwhelming odds.`,
    "* Subtle humour through the contrast between medieval warfare and software development.",
    "* Clean, balanced composition with minimal visual clutter.",
    "* Landscape 16:9 aspect ratio, suitable for a presentation slide.",
    "",
    "Strict requirements:",
    `No ${solo ? "teammates, no " : ""}spectators, no speech bubbles, no cartoon creatures, no championship belts, no exaggerated superhero aesthetic and no generic AI-generated illustration look. ${characters} Make the enemy army realistic fantasy orcs, not anthropomorphic work-item cards.`,
    "The final result should look like an authentic, high-budget fantasy blockbuster movie poster: serious, majestic, atmospheric and unintentionally hilarious because of its software engineering theme.",
    "Ensure all text, names, numbers and statistics are reproduced exactly as provided.",
  ].join("\n");
}
