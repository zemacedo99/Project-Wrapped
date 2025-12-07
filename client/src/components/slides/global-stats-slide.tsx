import { useEffect, useState } from "react";
import { useIntersectionObserver } from "@/hooks/use-intersection-observer";
import { useAnimatedCounter, formatNumber } from "@/hooks/use-animated-counter";
import type { ProjectStats } from "@shared/schema";
import { Card } from "@/components/ui/card";
import { GitCommit, GitPullRequest, Eye, MessageCircle, Target, Zap, FileCode, Clock, Flame, FolderGit } from "lucide-react";

interface GlobalStatsSlideProps {
  stats: ProjectStats;
}

interface StatCardProps {
  icon: React.ReactNode;
  label: string;
  value: number;
  delay: number;
  isVisible: boolean;
  gradient: string;
}

function StatCard({ icon, label, value, delay, isVisible, gradient }: StatCardProps) {
  const [shouldAnimate, setShouldAnimate] = useState(false);
  const { count, startAnimation } = useAnimatedCounter({
    end: value,
    duration: 2000,
    delay,
  });

  useEffect(() => {
    if (isVisible && !shouldAnimate) {
      setShouldAnimate(true);
      startAnimation();
    }
  }, [isVisible, shouldAnimate, startAnimation]);

  const testId = label.toLowerCase().replace(/\s+/g, "-");

  return (
    <Card
      data-testid={`stat-card-${testId}`}
      className={`relative p-8 bg-card/50 backdrop-blur-sm border-white/10 overflow-visible transition-all duration-500 ${
        isVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-8"
      }`}
      style={{ transitionDelay: `${delay}ms` }}
    >
      <div
        className={`absolute inset-0 rounded-lg opacity-20 ${gradient}`}
        style={{ background: `linear-gradient(135deg, ${gradient.includes("primary") ? "hsl(271 91% 65%)" : gradient.includes("accent") ? "hsl(330 81% 60%)" : gradient.includes("chart-2") ? "hsl(160 84% 39%)" : gradient.includes("chart-3") ? "hsl(199 89% 48%)" : gradient.includes("chart-4") ? "hsl(38 92% 50%)" : "hsl(271 91% 65%)"} 0%, transparent 100%)` }}
      />
      <div className="relative z-10">
        <div className="flex items-center gap-3 mb-4">
          <div className={`p-2 rounded-lg bg-gradient-to-br ${gradient.includes("primary") ? "from-primary/30 to-primary/10" : gradient.includes("accent") ? "from-accent/30 to-accent/10" : gradient.includes("chart-2") ? "from-chart-2/30 to-chart-2/10" : gradient.includes("chart-3") ? "from-chart-3/30 to-chart-3/10" : gradient.includes("chart-4") ? "from-chart-4/30 to-chart-4/10" : "from-primary/30 to-primary/10"}`}>
            {icon}
          </div>
          <span className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
            {label}
          </span>
        </div>
        <div className="text-5xl md:text-6xl font-black tabular-nums">
          {formatNumber(count)}
        </div>
      </div>
    </Card>
  );
}

export function GlobalStatsSlide({ stats }: GlobalStatsSlideProps) {
  const [ref, isVisible] = useIntersectionObserver<HTMLElement>({ threshold: 0.2 });

  // Filter to show only stats with meaningful values
  const allStatCards = [
    {
      icon: <GitCommit className="w-6 h-6 text-primary" />,
      label: "Total Commits",
      value: stats.totalCommits,
      gradient: "primary",
    },
    {
      icon: <GitPullRequest className="w-6 h-6 text-accent" />,
      label: "Pull Requests",
      value: stats.totalPullRequests,
      gradient: "accent",
    },
    {
      icon: <Eye className="w-6 h-6 text-chart-3" />,
      label: "Code Reviews",
      value: stats.totalReviews,
      gradient: "chart-3",
    },
    {
      icon: <MessageCircle className="w-6 h-6 text-chart-2" />,
      label: "Comments",
      value: stats.totalComments,
      gradient: "chart-2",
    },
    {
      icon: <FileCode className="w-6 h-6 text-chart-4" />,
      label: "Files Changed",
      value: stats.totalFilesChanged || 0,
      gradient: "chart-4",
    },
    {
      icon: <FolderGit className="w-6 h-6 text-primary" />,
      label: "Repositories",
      value: stats.totalRepositories || 0,
      gradient: "primary",
    },
    {
      icon: <Flame className="w-6 h-6 text-accent" />,
      label: "Longest Streak",
      value: stats.longestStreak || 0,
      gradient: "accent",
      suffix: " days",
    },
    {
      icon: <Clock className="w-6 h-6 text-chart-3" />,
      label: "Avg PR Merge Time",
      value: stats.avgPrMergeTimeHours || 0,
      gradient: "chart-3",
      suffix: "h",
    },
    {
      icon: <Zap className="w-6 h-6 text-chart-4" />,
      label: "Work Items",
      value: stats.totalWorkItems || 0,
      gradient: "chart-4",
    },
    {
      icon: <Target className="w-6 h-6 text-primary" />,
      label: "Story Points",
      value: stats.totalStoryPointsDone,
      gradient: "primary",
    },
  ];

  // Only show cards with values > 0
  const statCards = allStatCards.filter(card => card.value > 0);

  return (
    <section
      ref={ref}
      data-testid="slide-global-stats"
      className="min-h-screen flex flex-col items-center justify-center px-6 py-16 relative"
    >
      <div className="absolute inset-0 bg-gradient-to-b from-transparent via-primary/5 to-transparent pointer-events-none" />

      <div className="relative z-10 max-w-6xl mx-auto w-full">
        <div
          className={`text-center mb-16 transition-all duration-700 ${
            isVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-8"
          }`}
        >
          <h2 className="text-4xl md:text-5xl lg:text-6xl font-black mb-4">
            The Numbers
          </h2>
          <p className="text-xl text-muted-foreground">
            {stats.prMergeRate ? `${stats.prMergeRate}% PR merge rate • ` : ''}
            Every commit, review, and comment that made it happen
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {statCards.map((stat, index) => (
            <StatCard
              key={stat.label}
              icon={stat.icon}
              label={stat.label}
              value={stat.value}
              delay={index * 100}
              isVisible={isVisible}
              gradient={stat.gradient}
            />
          ))}
        </div>
      </div>
    </section>
  );
}
