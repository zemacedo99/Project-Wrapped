import type { WrappedMeta } from "@shared/schema";
import { Database, Info, AlertTriangle, CheckCircle2, XCircle } from "lucide-react";

interface DataProvenanceProps {
  meta?: WrappedMeta;
  dateRange: { start: string; end: string };
  showStoryPoints?: boolean;
  contributorFilter?: { active: boolean; shown: number; total: number };
  workItemBreakdown?: Record<string, number>;
}

type CompletenessStatus = "complete" | "partial" | "failed" | "unknown";

function formatDate(dateString: string): string {
  const date = new Date(dateString);
  if (Number.isNaN(date.getTime())) return dateString;
  return date.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

// Show repository names when there are only a few; fall back to a count + an
// expandable list when there are many.
function RepoList({ repos }: { repos: string[] }) {
  if (repos.length === 0) return null;
  if (repos.length <= 5) {
    return <span className="text-foreground">{repos.join(", ")}</span>;
  }
  return (
    <details className="inline">
      <summary className="inline cursor-pointer text-foreground underline">
        {repos.length} repositories — view selected
      </summary>
      <span className="mt-1 block">{repos.join(", ")}</span>
    </details>
  );
}

function StatusPill({ status }: { status: CompletenessStatus }) {
  if (status === "unknown") return null;
  const config = {
    complete: { label: "Complete", cls: "text-emerald-400 bg-emerald-500/10 border-emerald-500/30", Icon: CheckCircle2 },
    partial: { label: "Partial data", cls: "text-amber-400 bg-amber-500/10 border-amber-500/30", Icon: AlertTriangle },
    failed: { label: "Import failed", cls: "text-red-400 bg-red-500/10 border-red-500/30", Icon: XCircle },
  }[status];
  const { Icon } = config;
  return (
    <span
      data-testid="completeness-pill"
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium ${config.cls}`}
    >
      <Icon className="h-3 w-3" />
      {config.label}
    </span>
  );
}

/**
 * Compact, traceable "How these numbers were calculated" panel.
 *
 * Surfaces the provenance attached to the wrapped data (source, filters, repos,
 * counts, KPI definitions, caveats) AND import completeness — so partial data is
 * never presented as if it were whole. A prominent banner is shown (without
 * needing to expand the panel) whenever the import was partial or failed.
 *
 * Uses a native <details> element so it stays robust in PNG/PDF export and needs
 * no extra dependencies.
 */
export function DataProvenance({ meta, dateRange, showStoryPoints = true, contributorFilter, workItemBreakdown }: DataProvenanceProps) {
  if (!meta) return null;

  const summaryBits: string[] = [meta.source];
  if (meta.project) summaryBits.push(meta.project);
  summaryBits.push(`${formatDate(dateRange.start)} – ${formatDate(dateRange.end)}`);

  const c = meta.counts;
  // Hide the story-points definition when story points are turned off.
  const definitions = (meta.definitions ?? []).filter(
    d => showStoryPoints || !/^story points:/i.test(d)
  );
  const filterActive = contributorFilter?.active ?? false;
  const comp = meta.completeness;
  const status: CompletenessStatus = comp?.status ?? "unknown";
  const showBanner = comp && (status === "partial" || status === "failed");
  const repos = comp?.repositories;
  const wi = comp?.workItems;
  const includedRepos = meta.repositoriesIncluded ?? [];
  const commitFailures = comp?.commitFailures ?? [];
  const prFailures = comp?.pullRequestFailures ?? [];
  const wiTypes = workItemBreakdown
    ? Object.entries(workItemBreakdown).sort((a, b) => b[1] - a[1])
    : [];

  return (
    <div className="mt-12 mx-auto max-w-3xl text-left">
      {showBanner && (
        <div
          role="alert"
          data-testid="completeness-banner"
          className={`mb-3 rounded-xl border p-4 ${
            status === "failed" ? "border-red-500/40 bg-red-500/10" : "border-amber-500/40 bg-amber-500/10"
          }`}
        >
          <div className="flex items-start gap-3">
            {status === "failed" ? (
              <XCircle className="h-5 w-5 shrink-0 text-red-400" />
            ) : (
              <AlertTriangle className="h-5 w-5 shrink-0 text-amber-400" />
            )}
            <div className="min-w-0">
              <p className="text-sm font-semibold">
                {status === "failed"
                  ? "This recap is incomplete — key data could not be imported"
                  : "Some data may be missing from this recap"}
              </p>
              <ul className="mt-1.5 space-y-1 text-xs text-muted-foreground">
                {comp!.warnings.map((w, i) => (
                  <li key={i} className="flex gap-2">
                    <span className={status === "failed" ? "text-red-400" : "text-amber-400"}>•</span>
                    <span>{w}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      )}

      <details
        data-testid="data-provenance"
        className="rounded-xl border border-white/10 bg-card/40 backdrop-blur-sm"
      >
        <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 text-sm text-muted-foreground hover:text-foreground">
          <Database className="h-4 w-4 shrink-0" />
          <span className="font-medium">How these numbers were calculated</span>
          <span className="ml-auto flex items-center gap-2">
            <StatusPill status={status} />
            <span className="hidden truncate text-xs opacity-70 sm:inline">{summaryBits.join(" • ")}</span>
          </span>
        </summary>

        <div className="space-y-4 border-t border-white/10 px-4 py-4 text-sm">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {c && (
              <>
                <Stat label="Commits" value={c.commits} />
                <Stat label="Pull requests" value={c.pullRequests} />
                <Stat label="Work items" value={c.workItems} />
                <Stat label="Repositories" value={c.repositories} />
              </>
            )}
          </div>

          {comp && (
            <div data-testid="completeness-detail">
              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-foreground">
                Data completeness
              </p>
              {status === "complete" ? (
                <p className="flex items-center gap-1.5 text-xs text-emerald-400">
                  <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                  All requested repositories and work items were imported successfully.
                </p>
              ) : (
                <ul className="space-y-1 text-xs text-muted-foreground">
                  {repos && repos.found > 0 && (
                    <li>
                      {repos.found.toLocaleString()} repositories found
                      {repos.commitFetchFailed > 0 ? `; ${repos.commitFetchFailed} failed on commits` : ""}
                      {repos.pullRequestFetchFailed > 0 ? `; ${repos.pullRequestFetchFailed} failed on pull requests` : ""}.
                    </li>
                  )}
                  {wi && wi.idsFound > 0 && (
                    <li>
                      {wi.detailsFetched.toLocaleString()} of {wi.idsFound.toLocaleString()} work items loaded
                      {wi.detailBatchesFailed > 0 ? ` (${wi.detailBatchesFailed} batch(es) failed)` : ""}.
                    </li>
                  )}
                  {(!repos || repos.found === 0) && (!wi || wi.idsFound === 0) && (
                    <li>See the warning above for what could not be imported.</li>
                  )}
                </ul>
              )}

              {(commitFailures.length > 0 || prFailures.length > 0) && (
                <div className="mt-2 rounded-md border border-white/10 bg-white/5 p-2">
                  <p className="mb-1 text-[11px] font-medium text-foreground">Fetch failures (diagnostics)</p>
                  <ul className="space-y-0.5 text-[11px] text-muted-foreground">
                    {commitFailures.map((f, i) => (
                      <li key={`cf-${i}`}>
                        <span className="text-amber-400">commits</span> · <span className="text-foreground">{f.repo}</span> — {f.reason}
                      </li>
                    ))}
                    {prFailures.map((f, i) => (
                      <li key={`pf-${i}`}>
                        <span className="text-amber-400">PRs</span> · <span className="text-foreground">{f.repo}</span> — {f.reason}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}

          {meta.filters?.dateField && (
            <p className="text-xs text-muted-foreground">
              <span className="font-medium text-foreground">Date filter: </span>
              {meta.filters.dateField}
            </p>
          )}

          {includedRepos.length > 0 && (
            <p className="text-xs text-muted-foreground">
              <span className="font-medium text-foreground">Repositories: </span>
              <RepoList repos={includedRepos} />
            </p>
          )}

          {wiTypes.length > 0 && (
            <div>
              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-foreground">
                What the work items are
              </p>
              <p className="mb-1 text-xs text-muted-foreground">
                All types (including Tasks), any state, filtered by created date, across the whole
                project — repository selection does not change these.
              </p>
              <div className="flex flex-wrap gap-1.5">
                {wiTypes.map(([type, count]) => (
                  <span key={type} className="rounded-md bg-white/5 px-2 py-0.5 text-[11px] text-muted-foreground">
                    {type}: <span className="font-semibold tabular-nums text-foreground">{count.toLocaleString()}</span>
                  </span>
                ))}
              </div>
            </div>
          )}

          {(filterActive || (meta.repositoriesIncluded && meta.repositoriesIncluded.length > 0)) && (
            <div data-testid="active-filters">
              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-foreground">
                Active filters
              </p>
              <ul className="space-y-1 text-xs text-muted-foreground">
                {includedRepos.length > 0 && (
                  <li className="flex gap-2">
                    <span className="text-primary">•</span>
                    <span>
                      Repository scope (chosen at import): commit, PR and repository numbers come from{" "}
                      {includedRepos.length <= 5 ? <RepoList repos={includedRepos} /> : <>{includedRepos.length} repositories</>}
                      . Work items are project-wide.
                    </span>
                  </li>
                )}
                {filterActive && contributorFilter && (
                  <li className="flex gap-2">
                    <span className="text-amber-400">•</span>
                    <span>
                      Contributor filter active — showing {contributorFilter.shown.toLocaleString()} of{" "}
                      {contributorFilter.total.toLocaleString()} people. This affects the Team, Hall of
                      Fame and Top Contributors sections only; the project totals above are for the whole
                      project.
                    </span>
                  </li>
                )}
              </ul>
            </div>
          )}

          {definitions.length > 0 && (
            <div>
              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-foreground">
                Metric definitions
              </p>
              <ul className="space-y-1 text-xs text-muted-foreground">
                {definitions.map((d, i) => (
                  <li key={i} className="flex gap-2">
                    <span className="text-primary">•</span>
                    <span>{d}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {meta.notes && meta.notes.length > 0 && (
            <div>
              <p className="mb-1 flex items-center gap-1 text-xs font-semibold uppercase tracking-wide text-foreground">
                <Info className="h-3 w-3" /> Caveats
              </p>
              <ul className="space-y-1 text-xs text-muted-foreground">
                {meta.notes.map((n, i) => (
                  <li key={i} className="flex gap-2">
                    <span className="text-chart-4">•</span>
                    <span>{n}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {meta.generatedAt && (
            <p className="pt-1 text-[11px] text-muted-foreground/70">
              Generated {formatDate(meta.generatedAt)} from {meta.source}
              {meta.baseUrl ? ` (${meta.baseUrl})` : ""}
            </p>
          )}
        </div>
      </details>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg bg-white/5 p-2 text-center">
      <p className="text-lg font-bold tabular-nums">{value.toLocaleString()}</p>
      <p className="text-[11px] text-muted-foreground">{label}</p>
    </div>
  );
}
