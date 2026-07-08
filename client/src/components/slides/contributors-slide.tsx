import { useIntersectionObserver } from "@/hooks/use-intersection-observer";
import type { Contributor } from "@shared/schema";
import { Card } from "@/components/ui/card";
import { Users, GitCommit, GitPullRequest, Eye, Bug, Target } from "lucide-react";

interface ContributorsSlideProps {
  contributors: Contributor[];
}

interface StatChipProps {
  icon: React.ReactNode;
  value: number;
  label: string;
}

function StatChip({ icon, value, label }: StatChipProps) {
  if (!value || value <= 0) return null;
  return (
    <div
      className="flex items-center gap-1 px-2 py-1 rounded-md bg-white/5 text-xs"
      title={label}
    >
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
}: {
  contributor: Contributor;
  rank: number;
  delay: number;
  isVisible: boolean;
}) {
  const name = contributor.name || "Unknown";
  const testId = name.toLowerCase().replace(/\s+/g, "-");

  return (
    <Card
      data-testid={`contributor-card-${testId}`}
      className={`p-4 bg-card/40 backdrop-blur-sm border-white/10 transition-all duration-500 hover-elevate ${
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
          </p>
        </div>
      </div>

      <div className="flex flex-wrap gap-1.5">
        <StatChip
          icon={<GitCommit className="w-3 h-3 text-primary" />}
          value={contributor.commits}
          label="Commits"
        />
        <StatChip
          icon={<GitPullRequest className="w-3 h-3 text-accent" />}
          value={contributor.pullRequestsOpened}
          label="PRs opened"
        />
        <StatChip
          icon={<Eye className="w-3 h-3 text-chart-3" />}
          value={contributor.pullRequestsReviewed}
          label="Reviews"
        />
        <StatChip
          icon={<Bug className="w-3 h-3 text-destructive" />}
          value={contributor.bugsFixed}
          label="Bugs fixed"
        />
        <StatChip
          icon={<Target className="w-3 h-3 text-chart-2" />}
          value={contributor.storyPointsDone}
          label="Story points"
        />
      </div>
    </Card>
  );
}

export function ContributorsSlide({ contributors }: ContributorsSlideProps) {
  const [ref, isVisible] = useIntersectionObserver<HTMLElement>({ threshold: 0.1 });

  if (!contributors || contributors.length === 0) return null;

  return (
    <section
      ref={ref}
      data-testid="slide-contributors"
      className="min-h-screen flex flex-col items-center justify-center px-6 py-16 relative"
    >
      <div className="absolute inset-0 bg-gradient-to-br from-accent/5 via-transparent to-primary/5 pointer-events-none" />

      <div className="relative z-10 max-w-6xl mx-auto w-full">
        <div
          className={`text-center mb-12 transition-all duration-700 ${
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

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 max-h-[70vh] overflow-y-auto pr-1">
          {contributors.map((contributor, index) => (
            <ContributorCard
              key={`${contributor.name}-${index}`}
              contributor={contributor}
              rank={index + 1}
              delay={Math.min(index * 40, 600)}
              isVisible={isVisible}
            />
          ))}
        </div>
      </div>
    </section>
  );
}
