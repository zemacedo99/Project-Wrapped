import type { WrappedMeta } from "@shared/schema";
import { Database, Info } from "lucide-react";

interface DataProvenanceProps {
  meta?: WrappedMeta;
  dateRange: { start: string; end: string };
}

function formatDate(dateString: string): string {
  const date = new Date(dateString);
  if (Number.isNaN(date.getTime())) return dateString;
  return date.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

/**
 * Compact, traceable "How these numbers were calculated" panel.
 *
 * Surfaces the provenance attached to the wrapped data (source, filters, repos,
 * counts, KPI definitions and caveats) so every headline number can be traced
 * back to the real source query. Uses a native <details> element so it stays
 * robust in PNG/PDF export and needs no extra dependencies.
 */
export function DataProvenance({ meta, dateRange }: DataProvenanceProps) {
  if (!meta) return null;

  const summaryBits: string[] = [meta.source];
  if (meta.project) summaryBits.push(meta.project);
  summaryBits.push(`${formatDate(dateRange.start)} – ${formatDate(dateRange.end)}`);

  const c = meta.counts;

  return (
    <details
      data-testid="data-provenance"
      className="mt-12 mx-auto max-w-3xl text-left rounded-xl border border-white/10 bg-card/40 backdrop-blur-sm"
    >
      <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 text-sm text-muted-foreground hover:text-foreground">
        <Database className="h-4 w-4 shrink-0" />
        <span className="font-medium">How these numbers were calculated</span>
        <span className="ml-auto truncate text-xs opacity-70">{summaryBits.join(" • ")}</span>
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

        {meta.filters?.dateField && (
          <p className="text-xs text-muted-foreground">
            <span className="font-medium text-foreground">Date filter: </span>
            {meta.filters.dateField}
          </p>
        )}

        {meta.repositoriesIncluded && meta.repositoriesIncluded.length > 0 && (
          <p className="text-xs text-muted-foreground">
            <span className="font-medium text-foreground">Repositories: </span>
            {meta.repositoriesIncluded.join(", ")}
          </p>
        )}

        {meta.definitions && meta.definitions.length > 0 && (
          <div>
            <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-foreground">
              Metric definitions
            </p>
            <ul className="space-y-1 text-xs text-muted-foreground">
              {meta.definitions.map((d, i) => (
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
