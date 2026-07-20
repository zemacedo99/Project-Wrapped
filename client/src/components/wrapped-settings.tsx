import { useMemo, useRef, useState } from "react";
import type { ProjectWrappedData, WrappedConfig } from "@shared/schema";
import {
  DEFAULT_CONFIG,
  HIDEABLE_SLIDES,
  METRIC_IDS,
  filterContributors,
  normalizeConfig,
  reconcileConfig,
  serializeConfig,
  sortContributors,
  type ContribFilter,
  type ContribSort,
} from "@/lib/wrapped-config";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Download, Upload, RotateCcw, FolderGit, Users } from "lucide-react";

interface WrappedSettingsProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  data: ProjectWrappedData;
  config: WrappedConfig;
  onConfigChange: (config: WrappedConfig) => void;
}

const METRIC_LABELS: Record<(typeof METRIC_IDS)[number], string> = {
  commits: "Total Commits",
  pullRequests: "Pull Requests",
  reviews: "Code Reviews",
  comments: "Comments",
  filesChanged: "Files Changed",
  repositories: "Repositories",
  longestStreak: "Longest Streak",
  avgPrMergeTime: "Avg PR Merge Time",
  workItems: "Work Items",
  storyPoints: "Story Points",
};

// Cap how many contributor rows we render at once. Selection actions still apply
// to the full filtered set, so this only bounds the DOM for 1000s of contributors.
const RENDER_CAP = 200;

export function WrappedSettings({ open, onOpenChange, data, config, onConfigChange }: WrappedSettingsProps) {
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<ContribSort>("commits");
  const [filter, setFilter] = useState<ContribFilter>("all");

  const update = (patch: Partial<WrappedConfig>) => onConfigChange({ ...config, ...patch });

  const selectedNames = useMemo(
    () => new Set(config.contributorSelection.names),
    [config.contributorSelection.names]
  );

  const filteredContributors = useMemo(() => {
    const filtered = filterContributors(data.contributors, filter, search);
    return sortContributors(filtered, sort);
  }, [data.contributors, filter, search, sort]);

  const rendered = filteredContributors.slice(0, RENDER_CAP);
  const includedRepos = data.meta?.repositoriesIncluded ?? [];

  // Identity associations: git identities with no Azure match can be merged into
  // an Azure-backed person. Candidates for the canonical target are Azure/mixed people.
  const [assocSearch, setAssocSearch] = useState("");
  const unmappedGit = useMemo(
    () => data.contributors.filter(c => c.isUnmappedGit),
    [data.contributors]
  );
  const azureCandidates = useMemo(
    () => data.contributors.filter(c => !c.isUnmappedGit).sort((a, b) => a.name.localeCompare(b.name)),
    [data.contributors]
  );
  const targetOf = (gitName: string) =>
    config.identityAssociations.find(a => a.aliasNames.includes(gitName))?.canonicalName ?? "";

  const mergeInto = (gitName: string, canonicalName: string) => {
    // Remove this git identity from any existing association first.
    let associations = config.identityAssociations.map(a => ({
      ...a,
      aliasNames: a.aliasNames.filter(n => n !== gitName),
    }));
    if (canonicalName) {
      const idx = associations.findIndex(a => a.canonicalName === canonicalName);
      if (idx >= 0) associations[idx] = { ...associations[idx], aliasNames: [...associations[idx].aliasNames, gitName] };
      else associations = [...associations, { canonicalName, aliasNames: [gitName] }];
    }
    update({ identityAssociations: associations.filter(a => a.aliasNames.length > 0) });
  };

  const removeAssociation = (canonicalName: string) =>
    update({ identityAssociations: config.identityAssociations.filter(a => a.canonicalName !== canonicalName) });

  const visibleUnmapped = unmappedGit.filter(c =>
    c.name.toLowerCase().includes(assocSearch.trim().toLowerCase())
  );

  const setMode = (mode: WrappedConfig["contributorSelection"]["mode"]) =>
    update({ contributorSelection: { ...config.contributorSelection, mode } });

  const toggleName = (name: string, checked: boolean) => {
    const next = new Set(selectedNames);
    if (checked) next.add(name);
    else next.delete(name);
    update({ contributorSelection: { ...config.contributorSelection, names: Array.from(next) } });
  };

  const selectAllFiltered = () => {
    const next = new Set(selectedNames);
    for (const c of filteredContributors) next.add(c.name);
    update({ contributorSelection: { ...config.contributorSelection, names: Array.from(next) } });
  };

  const deselectAllFiltered = () => {
    const filteredSet = new Set(filteredContributors.map(c => c.name));
    const next = Array.from(selectedNames).filter(n => !filteredSet.has(n));
    update({ contributorSelection: { ...config.contributorSelection, names: next } });
  };

  const toggleSlide = (id: string, visible: boolean) => {
    const hidden = new Set(config.hiddenSlides);
    if (visible) hidden.delete(id);
    else hidden.add(id);
    update({ hiddenSlides: Array.from(hidden) });
  };

  const toggleMetric = (id: string, visible: boolean) => {
    const hidden = new Set(config.hiddenMetrics);
    if (visible) hidden.delete(id);
    else hidden.add(id);
    update({ hiddenMetrics: Array.from(hidden) });
  };

  const handleDownload = () => {
    const blob = new Blob([serializeConfig(config)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${data.projectName.replace(/[^a-z0-9]/gi, "-")}-wrapped-config.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast({ title: "Configuration downloaded", description: "Reuse it later with Upload config." });
  };

  const handleUploadClick = () => fileInputRef.current?.click();

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (e.target) e.target.value = ""; // allow re-uploading the same file
    if (!file) return;

    let parsed: unknown;
    try {
      parsed = JSON.parse(await file.text());
    } catch {
      toast({ title: "Invalid file", description: "That file is not valid JSON.", variant: "destructive" });
      return;
    }

    const { config: normalized, warnings: normWarnings } = normalizeConfig(parsed);
    const { config: reconciled, warnings: recWarnings } = reconcileConfig(normalized, {
      repoNames: includedRepos,
      contributorNames: data.contributors.map(c => c.name),
    });
    const warnings = [...normWarnings, ...recWarnings];

    onConfigChange(reconciled);
    toast({
      title: warnings.length ? "Configuration imported with warnings" : "Configuration imported",
      description: warnings.length ? warnings.join(" ") : "Settings applied.",
      variant: warnings.length ? "default" : undefined,
    });
  };

  const handleReset = () => {
    onConfigChange({ ...DEFAULT_CONFIG });
    toast({ title: "Settings reset", description: "Back to defaults (Story Points off)." });
  };

  const selectionCount = config.contributorSelection.names.length;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-md overflow-y-auto" data-testid="wrapped-settings">
        <SheetHeader>
          <SheetTitle>Wrapped Settings</SheetTitle>
          <SheetDescription>
            Choose what appears in this recap before you present it. Settings are saved in this
            browser and can be exported to reuse later.
          </SheetDescription>
        </SheetHeader>

        <div className="space-y-8 py-6">
          {/* Display settings */}
          <section className="space-y-4">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Display</h3>

            <div className="flex items-center justify-between gap-4">
              <div>
                <Label htmlFor="show-story-points" className="font-medium">Show Story Points</Label>
                <p className="text-xs text-muted-foreground">Off by default. Hides all story-point cards, chips and values.</p>
              </div>
              <Switch
                id="show-story-points"
                checked={config.showStoryPoints}
                onCheckedChange={(v) => update({ showStoryPoints: v })}
                data-testid="switch-story-points"
              />
            </div>

            <div>
              <p className="mb-2 text-xs font-medium text-foreground">Sections shown</p>
              <div className="grid grid-cols-2 gap-2">
                {HIDEABLE_SLIDES.map(s => (
                  <label key={s.id} className="flex items-center gap-2 text-sm">
                    <Checkbox
                      checked={!config.hiddenSlides.includes(s.id)}
                      onCheckedChange={(v) => toggleSlide(s.id, v === true)}
                      data-testid={`slide-toggle-${s.id}`}
                    />
                    {s.label}
                  </label>
                ))}
              </div>
            </div>

            <details className="text-sm">
              <summary className="cursor-pointer text-xs font-medium text-foreground">Stat cards on "The Numbers"</summary>
              <div className="mt-2 grid grid-cols-2 gap-2">
                {METRIC_IDS.filter(id => id !== "storyPoints").map(id => (
                  <label key={id} className="flex items-center gap-2 text-sm">
                    <Checkbox
                      checked={!config.hiddenMetrics.includes(id)}
                      onCheckedChange={(v) => toggleMetric(id, v === true)}
                      data-testid={`metric-toggle-${id}`}
                    />
                    {METRIC_LABELS[id]}
                  </label>
                ))}
              </div>
            </details>
          </section>

          {/* Repositories (import-time) */}
          <section className="space-y-3">
            <h3 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              <FolderGit className="h-4 w-4" /> Repositories
            </h3>
            <p className="text-xs text-muted-foreground">
              Repository selection changes the numbers, so it is applied <strong>when the Wrapped is
              generated</strong> (in the Azure DevOps import dialog), not here. This recap was built
              from the {includedRepos.length} repositor{includedRepos.length === 1 ? "y" : "ies"} below.
            </p>
            {includedRepos.length > 0 && (
              <ScrollArea className="h-28 rounded-md border border-white/10 p-2">
                <ul className="space-y-1 text-xs text-muted-foreground">
                  {includedRepos.map(r => (
                    <li key={r}>• {r}</li>
                  ))}
                </ul>
              </ScrollArea>
            )}
          </section>

          {/* Contributors */}
          <section className="space-y-3">
            <h3 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              <Users className="h-4 w-4" /> Contributors
            </h3>
            <p className="text-xs text-muted-foreground">
              Filtering people changes the Team, Hall of Fame and Top Contributors sections. It does
              <strong> not</strong> change the aggregate project totals on "The Numbers".
            </p>

            <Select value={config.contributorSelection.mode} onValueChange={(v) => setMode(v as WrappedConfig["contributorSelection"]["mode"])}>
              <SelectTrigger data-testid="contributor-mode">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Show everyone</SelectItem>
                <SelectItem value="include">Only selected people</SelectItem>
                <SelectItem value="exclude">Everyone except selected</SelectItem>
              </SelectContent>
            </Select>

            <div className={config.contributorSelection.mode === "all" ? "pointer-events-none opacity-50" : ""}>
              <Input
                placeholder="Search contributors…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                data-testid="contributor-search"
              />

              <div className="mt-2 flex gap-2">
                <Select value={sort} onValueChange={(v) => setSort(v as ContribSort)}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Sort" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="commits">Sort: Commits</SelectItem>
                    <SelectItem value="prs">Sort: PRs</SelectItem>
                    <SelectItem value="reviews">Sort: Reviews</SelectItem>
                    <SelectItem value="bugs">Sort: Bugs fixed</SelectItem>
                    {config.showStoryPoints && <SelectItem value="storyPoints">Sort: Story points</SelectItem>}
                    <SelectItem value="name">Sort: Name</SelectItem>
                  </SelectContent>
                </Select>
                <Select value={filter} onValueChange={(v) => setFilter(v as ContribFilter)}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Filter" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All people</SelectItem>
                    <SelectItem value="commits">Has commits</SelectItem>
                    <SelectItem value="prs">Has PRs</SelectItem>
                    <SelectItem value="reviews">Has reviews</SelectItem>
                    <SelectItem value="workItems">Has work items</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground">
                <span>{selectionCount} selected</span>
                <div className="flex gap-2">
                  <button className="underline hover:text-foreground" onClick={selectAllFiltered} data-testid="select-all">Select all{search || filter !== "all" ? " (filtered)" : ""}</button>
                  <button className="underline hover:text-foreground" onClick={deselectAllFiltered} data-testid="deselect-all">Deselect</button>
                </div>
              </div>

              <ScrollArea className="mt-2 h-64 rounded-md border border-white/10 p-2">
                <div className="space-y-1">
                  {rendered.map(c => (
                    <label key={c.name} className="flex items-center gap-2 rounded px-1 py-0.5 text-sm hover:bg-white/5">
                      <Checkbox
                        checked={selectedNames.has(c.name)}
                        onCheckedChange={(v) => toggleName(c.name, v === true)}
                      />
                      <span className="min-w-0 flex-1 truncate" title={c.name}>{c.name}</span>
                      <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{c.commits.toLocaleString()}c</span>
                    </label>
                  ))}
                  {filteredContributors.length === 0 && (
                    <p className="px-1 py-2 text-xs text-muted-foreground">No contributors match.</p>
                  )}
                </div>
              </ScrollArea>
              {filteredContributors.length > RENDER_CAP && (
                <p className="mt-1 text-[11px] text-muted-foreground">
                  Showing first {RENDER_CAP} of {filteredContributors.length.toLocaleString()} — search to narrow.
                  “Select all” applies to all {filteredContributors.length.toLocaleString()}.
                </p>
              )}
            </div>
          </section>

          {/* Identity associations */}
          <section className="space-y-3">
            <h3 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              <Users className="h-4 w-4" /> Identity associations
            </h3>
            <p className="text-xs text-muted-foreground">
              People are auto-merged into one Azure DevOps account when their email/unique name or
              exact display name match. Link any remaining git-only identities to the right person
              here — their commits are then summed into that person everywhere.
            </p>

            {config.identityAssociations.length > 0 && (
              <div className="space-y-1">
                <p className="text-xs font-medium text-foreground">Confirmed</p>
                {config.identityAssociations.map(a => (
                  <div key={a.canonicalName} className="flex items-start justify-between gap-2 rounded-md bg-white/5 px-2 py-1 text-xs">
                    <span className="min-w-0">
                      <span className="font-medium text-foreground">{a.canonicalName}</span>{" "}
                      <span className="text-muted-foreground">← {a.aliasNames.join(", ")}</span>
                    </span>
                    <button className="shrink-0 text-muted-foreground underline hover:text-foreground" onClick={() => removeAssociation(a.canonicalName)}>
                      remove
                    </button>
                  </div>
                ))}
              </div>
            )}

            {unmappedGit.length === 0 ? (
              <p className="text-xs text-muted-foreground">No unmatched git identities — everyone is already unified. 🎉</p>
            ) : (
              <div className="space-y-2">
                <p className="text-xs font-medium text-foreground">
                  Unmatched git identities ({unmappedGit.length})
                </p>
                {unmappedGit.length > 8 && (
                  <Input
                    placeholder="Search git identities…"
                    value={assocSearch}
                    onChange={e => setAssocSearch(e.target.value)}
                    className="h-8"
                    data-testid="assoc-search"
                  />
                )}
                <datalist id="azure-candidates">
                  {azureCandidates.map(c => (
                    <option key={c.name} value={c.name} />
                  ))}
                </datalist>
                <ScrollArea className="h-48 rounded-md border border-white/10 p-2">
                  <div className="space-y-1.5">
                    {visibleUnmapped.slice(0, 100).map(c => (
                      <div key={c.name} className="flex items-center gap-2 text-xs">
                        <span className="min-w-0 flex-1 truncate" title={c.name}>
                          {c.name}
                          <span className="ml-1 text-muted-foreground">({c.commits.toLocaleString()}c)</span>
                        </span>
                        <Input
                          list="azure-candidates"
                          placeholder="Merge into…"
                          defaultValue={targetOf(c.name)}
                          onChange={e => {
                            const v = e.target.value.trim();
                            if (v === "") mergeInto(c.name, "");
                            else if (azureCandidates.some(a => a.name === v)) mergeInto(c.name, v);
                          }}
                          className="h-7 w-40 text-xs"
                        />
                      </div>
                    ))}
                    {visibleUnmapped.length === 0 && (
                      <p className="px-1 py-1 text-muted-foreground">No matches.</p>
                    )}
                  </div>
                </ScrollArea>
                {visibleUnmapped.length > 100 && (
                  <p className="text-[11px] text-muted-foreground">Showing first 100 — search to narrow.</p>
                )}
              </div>
            )}
          </section>

          {/* Export / import */}
          <section className="space-y-3 border-t border-white/10 pt-6">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Configuration</h3>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" onClick={handleDownload} data-testid="button-download-config">
                <Download className="mr-2 h-4 w-4" /> Download config
              </Button>
              <Button variant="outline" size="sm" onClick={handleUploadClick} data-testid="button-upload-config">
                <Upload className="mr-2 h-4 w-4" /> Upload config
              </Button>
              <Button variant="ghost" size="sm" onClick={handleReset} data-testid="button-reset-config">
                <RotateCcw className="mr-2 h-4 w-4" /> Reset
              </Button>
              <input
                ref={fileInputRef}
                type="file"
                accept="application/json,.json"
                className="hidden"
                onChange={handleFile}
                data-testid="input-config-file"
              />
            </div>
          </section>
        </div>
      </SheetContent>
    </Sheet>
  );
}
