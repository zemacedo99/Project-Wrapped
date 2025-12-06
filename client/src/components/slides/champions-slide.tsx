import { useEffect, useState } from "react";
import { useIntersectionObserver } from "@/hooks/use-intersection-observer";
import { useAnimatedCounter, formatNumber } from "@/hooks/use-animated-counter";
import type { Contributor } from "@shared/schema";
import { Card } from "@/components/ui/card";
import { Trophy, Crown, MessageCircle, GitPullRequest, Bug, Zap } from "lucide-react";

interface ChampionsSlideProps {
  contributors: Contributor[];
}

interface ChampionCardProps {
  title: string;
  subtitle: string;
  name: string;
  statValue: number;
  statLabel: string;
  icon: React.ReactNode;
  badge: React.ReactNode;
  gradientFrom: string;
  gradientTo: string;
  delay: number;
  isVisible: boolean;
}

function ChampionCard({
  title,
  subtitle,
  name,
  statValue,
  statLabel,
  icon,
  badge,
  gradientFrom,
  gradientTo,
  delay,
  isVisible,
}: ChampionCardProps) {
  const [shouldAnimate, setShouldAnimate] = useState(false);
  const { count, startAnimation } = useAnimatedCounter({
    end: statValue,
    duration: 2000,
    delay: delay + 300,
  });

  useEffect(() => {
    if (isVisible && !shouldAnimate) {
      setShouldAnimate(true);
      startAnimation();
    }
  }, [isVisible, shouldAnimate, startAnimation]);

  const testId = title.toLowerCase().replace(/\s+/g, "-");

  return (
    <Card
      data-testid={`champion-card-${testId}`}
      className={`relative p-8 bg-card/30 backdrop-blur-sm border-white/10 overflow-visible transition-all duration-700 ${
        isVisible ? "opacity-100 translate-y-0 scale-100" : "opacity-0 translate-y-12 scale-95"
      }`}
      style={{ transitionDelay: `${delay}ms` }}
    >
      <div
        className="absolute inset-0 rounded-lg opacity-30"
        style={{
          background: `linear-gradient(135deg, ${gradientFrom} 0%, ${gradientTo} 100%)`,
        }}
      />
      <div className="absolute -top-3 -right-3 animate-float">{badge}</div>

      <div className="relative z-10">
        <div className="flex items-center gap-3 mb-2">
          {icon}
          <span className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
            {subtitle}
          </span>
        </div>

        <h3 className="text-2xl md:text-3xl font-black mb-6 bg-gradient-to-r from-foreground to-foreground/80 bg-clip-text">
          {title}
        </h3>

        <div className="flex items-center gap-4 mb-6">
          <div className="w-16 h-16 rounded-full bg-gradient-to-br from-white/20 to-white/5 flex items-center justify-center text-2xl font-black">
            {name.charAt(0)}
          </div>
          <div>
            <p className="text-xl font-bold">{name}</p>
            <p className="text-sm text-muted-foreground">{statLabel}</p>
          </div>
        </div>

        <div className="text-5xl md:text-6xl font-black tabular-nums bg-gradient-to-r from-foreground to-foreground/70 bg-clip-text text-transparent">
          {formatNumber(count)}
        </div>
      </div>
    </Card>
  );
}

function findChampion(
  contributors: Contributor[],
  key: keyof Contributor
): Contributor | undefined {
  return contributors.reduce((prev, current) => {
    const prevValue = prev[key] as number;
    const currentValue = current[key] as number;
    return currentValue > prevValue ? current : prev;
  }, contributors[0]);
}

export function ChampionsSlide({ contributors }: ChampionsSlideProps) {
  const [ref, isVisible] = useIntersectionObserver<HTMLElement>({ threshold: 0.2 });

  if (contributors.length === 0) return null;

  const reviewChampion = findChampion(contributors, "pullRequestsReviewed");
  const commentsChampion = findChampion(contributors, "commentsWritten");
  const commitChampion = findChampion(contributors, "commits");
  const bugSlayer = findChampion(contributors, "bugsFixed");

  return (
    <section
      ref={ref}
      data-testid="slide-champions"
      className="min-h-screen flex flex-col items-center justify-center px-6 py-16 relative"
    >
      <div className="absolute inset-0 bg-gradient-to-br from-primary/10 via-transparent to-accent/10 pointer-events-none" />
      <div className="absolute top-1/3 right-0 w-72 h-72 bg-accent/20 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute bottom-1/3 left-0 w-72 h-72 bg-primary/20 rounded-full blur-3xl pointer-events-none" />

      <div className="relative z-10 max-w-6xl mx-auto w-full">
        <div
          className={`text-center mb-16 transition-all duration-700 ${
            isVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-8"
          }`}
        >
          <div className="flex items-center justify-center gap-3 mb-4">
            <Trophy className="w-8 h-8 text-chart-4" />
            <h2 className="text-4xl md:text-5xl lg:text-6xl font-black">
              Hall of Fame
            </h2>
            <Trophy className="w-8 h-8 text-chart-4" />
          </div>
          <p className="text-xl text-muted-foreground">
            Celebrating the MVPs who made it happen
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          {reviewChampion && (
            <ChampionCard
              title="Review Champion"
              subtitle="Code Quality Guardian"
              name={reviewChampion.name}
              statValue={reviewChampion.pullRequestsReviewed}
              statLabel="Pull Requests Reviewed"
              icon={<GitPullRequest className="w-5 h-5 text-primary" />}
              badge={
                <div className="w-12 h-12 rounded-full bg-gradient-to-br from-chart-4 to-chart-5 flex items-center justify-center shadow-lg">
                  <Crown className="w-6 h-6 text-white" />
                </div>
              }
              gradientFrom="hsl(271 91% 65%)"
              gradientTo="hsl(330 81% 60%)"
              delay={0}
              isVisible={isVisible}
            />
          )}

          {commentsChampion && (
            <ChampionCard
              title="Comments Champion"
              subtitle="Communication Expert"
              name={commentsChampion.name}
              statValue={commentsChampion.commentsWritten}
              statLabel="Comments Written"
              icon={<MessageCircle className="w-5 h-5 text-chart-2" />}
              badge={
                <div className="w-12 h-12 rounded-full bg-gradient-to-br from-chart-2 to-chart-3 flex items-center justify-center shadow-lg">
                  <MessageCircle className="w-6 h-6 text-white" />
                </div>
              }
              gradientFrom="hsl(160 84% 39%)"
              gradientTo="hsl(199 89% 48%)"
              delay={150}
              isVisible={isVisible}
            />
          )}

          {commitChampion && (
            <ChampionCard
              title="Commit Champion"
              subtitle="Code Machine"
              name={commitChampion.name}
              statValue={commitChampion.commits}
              statLabel="Total Commits"
              icon={<Zap className="w-5 h-5 text-chart-4" />}
              badge={
                <div className="w-12 h-12 rounded-full bg-gradient-to-br from-chart-4 to-accent flex items-center justify-center shadow-lg">
                  <Zap className="w-6 h-6 text-white" />
                </div>
              }
              gradientFrom="hsl(38 92% 50%)"
              gradientTo="hsl(330 81% 60%)"
              delay={300}
              isVisible={isVisible}
            />
          )}

          {bugSlayer && bugSlayer.bugsFixed > 0 && (
            <ChampionCard
              title="Bug Slayer"
              subtitle="Debugging Hero"
              name={bugSlayer.name}
              statValue={bugSlayer.bugsFixed}
              statLabel="Bugs Fixed"
              icon={<Bug className="w-5 h-5 text-destructive" />}
              badge={
                <div className="w-12 h-12 rounded-full bg-gradient-to-br from-destructive to-accent flex items-center justify-center shadow-lg">
                  <Bug className="w-6 h-6 text-white" />
                </div>
              }
              gradientFrom="hsl(0 72% 51%)"
              gradientTo="hsl(330 81% 60%)"
              delay={450}
              isVisible={isVisible}
            />
          )}
        </div>
      </div>
    </section>
  );
}
