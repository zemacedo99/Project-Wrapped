import { useMemo, useState } from "react";
import { useIntersectionObserver } from "@/hooks/use-intersection-observer";
import type { Contributor } from "@shared/schema";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { sortContributors, filterContributors, type ContribSort } from "@/lib/wrapped-config";
import { Users, GitCommit, GitPullRequest, Eye, Bug, Target, GitBranch } from "lucide-react";

interface ContributorsSlideProps {
  contributors: Contributor[];
  showStoryPoints?: boolean;
}

interface StatChipProps {
  icon: React.ReactNode;
  value: number;
  label: string;
}

// Render at most this many cards for performance on very large teams.
const RENDER_CAP = 150;

function StatChip({ icon, value, label }: StatChipProps) {
  if (!value || value <= 0) return null;
  return (
    <div className="flex items-center gap-1 px-2 py-1 rounded-md bg-white/5 text-xs" title={label}>
      {icon}
      <span className="font-semibold tabular-nums">{value.toLocaleString()}</span>
    </div>
  );
}

function ContributorCard({
  contributor,
  rank,
  delay,
  isVisible,
  showStoryPoints,
  onClick,
}: {
  contributor: Contributor;
  rank: number;
  delay: number;
  isVisible: boolean;
  showStoryPoints: boolean;
  onClick: () => void;
}) {
  const name = contributor.name || "Unknown";
  const testId = name.toLowerCase().replace(/\s+/g, "-");
  const aliasCount = contributor.aliases?.length ?? 0;

  return (
    <Card
      data-testid={`contributor-card-${testId}`}
      onClick={onClick}
      className={`p-4 bg-card/40 backdrop-blur-sm border-white/10 transition-all duration-500 hover-elevate cursor-pointer ${
        isVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-6"
      }`}
      style={{ transitionDelay: `${delay}ms` }}
    >
      <div className="flex items-center gap-3 mb-3">
        <div className="relative">
          <div className="w-11 h-11 rounded-full bg-gradient-to-br from-primary/40 to-accent/20 flex items-center justify-center text-lg font-black">
            {name.charAt(0).toUpperCase()}
          </div>
          <div className="absolute -bottom-1 -right-1 w-5 h-5 rounded-full bg-background border border-white/10 flex items-center justify-center text-[10px] font-bold text-muted-foreground">
            {rank}
          </div>
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-semibold truncate" title={name}>
            {name}
          </p>
          <p className="text-xs text-muted-foreground">
            {contributor.commits.toLocaleString()} commits
            {aliasCount > 1 ? ` · ${aliasCount} identities` : ""}
            {contributor.isUnmappedGit ? " · unmatched git" : ""}
          </p>
        </div>
      </div>

      <div className="flex flex-wrap gap-1.5">
        <StatChip icon={<GitCommit className="w-3 h-3 text-primary" />} value={contributor.commits} label="Commits" />
        <StatChip icon={<GitPullRequest className="w-3 h-3 text-accent" />} value={contributor.pullRequestsOpened} label="PRs opened" />
        <StatChip icon={<Eye className="w-3 h-3 text-chart-3" />} value={contributor.pullRequestsReviewed} label="Reviews" />
        <StatChip icon={<Bug className="w-3 h-3 text-destructive" />} value={contributor.bugsFixed} label="Bugs fixed" />
        {showStoryPoints && (
          <StatChip icon={<Target className="w-3 h-3 text-chart-2" />} value={contributor.storyPointsDone} label="Story points" />
        )}
      </div>
    </Card>
  );
}

function DetailRow({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg bg-white/5 p-2 text-center">
      <p className="text-xl font-bold tabular-nums">{value.toLocaleString()}</p>
      <p className="text-[11px] text-muted-foreground">{label}</p>
    </div>
  );
}

function ContributorDetails({
  contributor,
  showStoryPoints,
  onClose,
}: {
  contributor: Contributor | null;
  showStoryPoints: boolean;
  onClose: () => void;
}) {
  if (!contributor) return null;
  const aliases = contributor.aliases ?? [];
  return (
    <Dialog open={!!contributor} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="w-[95vw] max-w-[95vw] sm:max-w-lg max-h-[90vh] overflow-y-auto" data-testid="contributor-details">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {contributor.name}
            <span className="rounded-full border border-white/15 px-2 py-0.5 text-[11px] font-normal text-muted-foreground">
              {contributor.isUnmappedGit ? "unmatched git identity" : contributor.source === "mixed" ? "Azure + git" : contributor.source ?? "identity"}
            </span>
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-2">
            <DetailRow label="Commits" value={contributor.commits} />
            <DetailRow label="PRs opened" value={contributor.pullRequestsOpened} />
            <DetailRow label="Reviews" value={contributor.pullRequestsReviewed} />
            <DetailRow label="Bugs fixed" value={contributor.bugsFixed} />
            {showStoryPoints && <DetailRow label="Story points" value={contributor.storyPointsDone} />}
            {contributor.longestStreak ? <DetailRow label="Longest streak" value={contributor.longestStreak} /> : null}
          </div>

          <div>
            <p className="mb-1 flex items-center gap-1 text-xs font-semibold uppercase tracking-wide text-foreground">
              <GitBranch className="h-3 w-3" /> Identities {aliases.length > 0 ? `(${aliases.length})` : ""}
            </p>
            {aliases.length > 0 ? (
              <ul className="space-y-1 text-xs">
                {aliases.map((a, i) => (
                  <li key={`${a.name}-${i}`} className="flex items-center justify-between gap-2 rounded-md bg-white/5 px-2 py-1">
                    <span className="min-w-0 truncate">
                      <span className="text-foreground">{a.name}</span>
                      <span className="ml-1 text-muted-foreground">
                        · {a.source}{a.email ? ` · ${a.email}` : ""}
                      </span>
                    </span>
                    <span className="shrink-0 tabular-nums text-muted-foreground">{a.commits.toLocaleString()} commits</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-xs text-muted-foreground">Single identity — no linked aliases.</p>
            )}
            <p className="mt-2 text-[11px] text-muted-foreground">
              Bug “resolved vs validated” per person needs work item history (not fetched yet).
            </p>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function ContributorsSlide({ contributors, showStoryPoints = false }: ContributorsSlideProps) {
  const [ref, isVisible] = useIntersectionObserver<HTMLElement>({ threshold: 0.1 });
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<ContribSort>("commits");
  const [selected, setSelected] = useState<Contributor | null>(null);

  const visible = useMemo(() => {
    const filtered = filterContributors(contributors, "all", search);
    return sortContributors(filtered, sort);
  }, [contributors, search, sort]);

  if (!contributors || contributors.length === 0) return null;

  const rendered = visible.slice(0, RENDER_CAP);

  return (
    <section
      ref={ref}
      data-testid="slide-contributors"
      className="min-h-screen flex flex-col items-center justify-center px-6 py-16 relative"
    >
      <div className="absolute inset-0 bg-gradient-to-br from-accent/5 via-transparent to-primary/5 pointer-events-none" />

      <div className="relative z-10 max-w-6xl mx-auto w-full">
        <div
          className={`text-center mb-8 transition-all duration-700 ${
            isVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-8"
          }`}
        >
          <div className="flex items-center justify-center gap-3 mb-4">
            <Users className="w-8 h-8 text-primary" />
            <h2 className="text-4xl md:text-5xl lg:text-6xl font-black">The Team</h2>
          </div>
          <p className="text-xl text-muted-foreground">
            {contributors.length.toLocaleString()} people made this project happen
          </p>
        </div>

        <div className="mb-4 flex flex-col sm:flex-row gap-2 sm:items-center sm:justify-between">
          <Input
            placeholder="Search team…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="sm:max-w-xs"
            data-testid="team-search"
          />
          <Select value={sort} onValueChange={(v) => setSort(v as ContribSort)}>
            <SelectTrigger className="sm:w-56" data-testid="team-sort">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="commits">Most commits</SelectItem>
              <SelectItem value="prs">Most PRs</SelectItem>
              <SelectItem value="reviews">Most reviews</SelectItem>
              <SelectItem value="bugs">Most bugs fixed</SelectItem>
              {showStoryPoints && <SelectItem value="storyPoints">Most story points</SelectItem>}
              <SelectItem value="name">Name (A–Z)</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 max-h-[60vh] overflow-y-auto pr-1">
          {rendered.map((contributor, index) => (
            <ContributorCard
              key={`${contributor.name}-${index}`}
              contributor={contributor}
              rank={index + 1}
              delay={Math.min(index * 20, 400)}
              isVisible={isVisible}
              showStoryPoints={showStoryPoints}
              onClick={() => setSelected(contributor)}
            />
          ))}
        </div>
        {visible.length > RENDER_CAP && (
          <p className="mt-2 text-center text-xs text-muted-foreground">
            Showing first {RENDER_CAP} of {visible.length.toLocaleString()} — search to narrow.
          </p>
        )}
        {visible.length === 0 && (
          <p className="mt-6 text-center text-muted-foreground">No team members match “{search}”.</p>
        )}
      </div>

      <ContributorDetails contributor={selected} showStoryPoints={showStoryPoints} onClose={() => setSelected(null)} />
    </section>
  );
}
