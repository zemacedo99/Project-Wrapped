import { useIntersectionObserver } from "@/hooks/use-intersection-observer";
import type { Top5 } from "@shared/schema";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { GitCommit, GitPullRequest, Eye, MessageCircle, Trophy, Medal, Award, Star, Flame } from "lucide-react";

interface Top5SlideProps {
  top5: Top5;
}

interface RankingListProps {
  title: string;
  icon: React.ReactNode;
  items: { name: string; value: number }[];
  valueLabel: string;
  gradientFrom: string;
  gradientTo: string;
  delay: number;
  isVisible: boolean;
}

function getRankBadge(rank: number) {
  switch (rank) {
    case 1:
      return (
        <div className="w-8 h-8 rounded-full bg-gradient-to-br from-chart-4 to-yellow-400 flex items-center justify-center shadow-md">
          <Trophy className="w-4 h-4 text-white" />
        </div>
      );
    case 2:
      return (
        <div className="w-8 h-8 rounded-full bg-gradient-to-br from-gray-300 to-gray-400 flex items-center justify-center shadow-md">
          <Medal className="w-4 h-4 text-white" />
        </div>
      );
    case 3:
      return (
        <div className="w-8 h-8 rounded-full bg-gradient-to-br from-amber-600 to-amber-700 flex items-center justify-center shadow-md">
          <Award className="w-4 h-4 text-white" />
        </div>
      );
    default:
      return (
        <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center">
          <span className="text-sm font-bold text-muted-foreground">{rank}</span>
        </div>
      );
  }
}

function getBadgeText(rank: number, category: string): string | null {
  if (rank !== 1) return null;
  switch (category) {
    case "commits":
      return "Commit Machine";
    case "prs":
      return "PR Master";
    case "reviews":
      return "Review Beast";
    case "comments":
      return "Feedback King";
    default:
      return "Top Performer";
  }
}

function RankingList({
  title,
  icon,
  items,
  valueLabel,
  gradientFrom,
  gradientTo,
  delay,
  isVisible,
}: RankingListProps) {
  const category = title.toLowerCase().includes("commit")
    ? "commits"
    : title.toLowerCase().includes("opened")
    ? "prs"
    : title.toLowerCase().includes("review")
    ? "reviews"
    : "comments";

  const testId = title.toLowerCase().replace(/\s+/g, "-");

  return (
    <Card
      data-testid={`ranking-${testId}`}
      className={`p-6 bg-card/40 backdrop-blur-sm border-white/10 transition-all duration-700 ${
        isVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-8"
      }`}
      style={{ transitionDelay: `${delay}ms` }}
    >
      <div className="flex items-center gap-3 mb-6">
        <div
          className="p-2 rounded-lg"
          style={{
            background: `linear-gradient(135deg, ${gradientFrom}40 0%, ${gradientTo}20 100%)`,
          }}
        >
          {icon}
        </div>
        <h3 className="text-lg font-bold">{title}</h3>
      </div>

      <div className="space-y-3">
        {items.slice(0, 5).map((item, index) => {
          const badgeText = getBadgeText(index + 1, category);
          return (
            <div
              key={`${item.name}-${index}`}
              data-testid={`ranking-item-${category}-${index + 1}`}
              className="flex items-center gap-3 p-3 rounded-lg bg-white/5 hover-elevate active-elevate-2"
            >
              {getRankBadge(index + 1)}
              <div className="flex-1 min-w-0">
                <p className="font-semibold truncate">{item.name}</p>
                {badgeText && (
                  <Badge
                    variant="secondary"
                    className="mt-1 text-xs bg-gradient-to-r from-primary/20 to-accent/20"
                  >
                    <Star className="w-3 h-3 mr-1" />
                    {badgeText}
                  </Badge>
                )}
              </div>
              <div className="text-right">
                <p className="text-lg font-bold tabular-nums">{item.value.toLocaleString()}</p>
                <p className="text-xs text-muted-foreground">{valueLabel}</p>
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

export function Top5Slide({ top5 }: Top5SlideProps) {
  const [ref, isVisible] = useIntersectionObserver<HTMLElement>({ threshold: 0.15 });

  const rankings = [
    {
      title: "Most Commits",
      icon: <GitCommit className="w-5 h-5 text-primary" />,
      items: top5.mostCommits.map((e) => ({ name: e.name, value: e.commits || 0 })),
      valueLabel: "commits",
      gradientFrom: "hsl(271 91% 65%)",
      gradientTo: "hsl(330 81% 60%)",
    },
    {
      title: "Most PRs Opened",
      icon: <GitPullRequest className="w-5 h-5 text-accent" />,
      items: top5.mostPullRequestsOpened.map((e) => ({
        name: e.name,
        value: e.pullRequestsOpened || 0,
      })),
      valueLabel: "PRs",
      gradientFrom: "hsl(330 81% 60%)",
      gradientTo: "hsl(271 91% 65%)",
    },
    {
      title: "Most Reviews",
      icon: <Eye className="w-5 h-5 text-chart-3" />,
      items: top5.mostPullRequestsReviewed.map((e) => ({
        name: e.name,
        value: e.pullRequestsReviewed || 0,
      })),
      valueLabel: "reviews",
      gradientFrom: "hsl(199 89% 48%)",
      gradientTo: "hsl(160 84% 39%)",
    },
    {
      title: "Most Comments",
      icon: <MessageCircle className="w-5 h-5 text-chart-2" />,
      items: top5.mostCommentsWritten.map((e) => ({
        name: e.name,
        value: e.commentsWritten || 0,
      })),
      valueLabel: "comments",
      gradientFrom: "hsl(160 84% 39%)",
      gradientTo: "hsl(199 89% 48%)",
    },
  ];

  // Add longest streaks if available
  if (top5.longestStreaks && top5.longestStreaks.length > 0) {
    rankings.push({
      title: "Longest Streaks",
      icon: <Flame className="w-5 h-5 text-chart-4" />,
      items: top5.longestStreaks.map((e) => ({
        name: e.name,
        value: e.commits || 0,
      })),
      valueLabel: "days",
      gradientFrom: "hsl(38 92% 50%)",
      gradientTo: "hsl(0 84% 60%)",
    });
  }

  return (
    <section
      ref={ref}
      data-testid="slide-top5"
      className="min-h-screen flex flex-col items-center justify-center px-6 py-16 relative"
    >
      <div className="absolute inset-0 bg-gradient-to-t from-primary/5 via-transparent to-accent/5 pointer-events-none" />

      <div className="relative z-10 max-w-6xl mx-auto w-full">
        <div
          className={`text-center mb-12 transition-all duration-700 ${
            isVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-8"
          }`}
        >
          <h2 className="text-4xl md:text-5xl lg:text-6xl font-black mb-4">
            Top Contributors
          </h2>
          <p className="text-xl text-muted-foreground">
            The leaderboards that defined our progress
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {rankings.map((ranking, index) => (
            <RankingList
              key={ranking.title}
              title={ranking.title}
              icon={ranking.icon}
              items={ranking.items}
              valueLabel={ranking.valueLabel}
              gradientFrom={ranking.gradientFrom}
              gradientTo={ranking.gradientTo}
              delay={index * 100}
              isVisible={isVisible}
            />
          ))}
        </div>
      </div>
    </section>
  );
}
