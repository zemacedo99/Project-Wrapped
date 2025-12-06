import { useQuery } from "@tanstack/react-query";
import type { ProjectWrappedData } from "@shared/schema";
import { IntroSlide } from "@/components/slides/intro-slide";
import { GlobalStatsSlide } from "@/components/slides/global-stats-slide";
import { ChampionsSlide } from "@/components/slides/champions-slide";
import { Top5Slide } from "@/components/slides/top5-slide";
import { ModulesSlide } from "@/components/slides/modules-slide";
import { TimelineSlide } from "@/components/slides/timeline-slide";
import { HighlightsSlide } from "@/components/slides/highlights-slide";
import { OutroSlide } from "@/components/slides/outro-slide";
import { NavigationDots, useActiveSection, scrollToSection } from "@/components/navigation-dots";
import { Skeleton } from "@/components/ui/skeleton";

const sectionIds = [
  "slide-intro",
  "slide-global-stats",
  "slide-champions",
  "slide-top5",
  "slide-modules",
  "slide-timeline",
  "slide-highlights",
  "slide-outro",
];

const sectionNames = [
  "Intro",
  "Stats",
  "Champions",
  "Top 5",
  "Modules",
  "Timeline",
  "Highlights",
  "Outro",
];

function LoadingState() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-6 py-16 relative">
      <div className="absolute inset-0 bg-gradient-to-br from-primary/20 via-transparent to-accent/20 pointer-events-none" />
      <div className="relative z-10 text-center max-w-2xl mx-auto space-y-8">
        <Skeleton className="h-16 w-64 mx-auto rounded-lg" />
        <Skeleton className="h-24 w-96 mx-auto rounded-lg" />
        <Skeleton className="h-8 w-48 mx-auto rounded-lg" />
        <div className="flex items-center justify-center gap-2 mt-8">
          <div className="w-3 h-3 rounded-full bg-primary animate-bounce" style={{ animationDelay: "0ms" }} />
          <div className="w-3 h-3 rounded-full bg-accent animate-bounce" style={{ animationDelay: "150ms" }} />
          <div className="w-3 h-3 rounded-full bg-chart-2 animate-bounce" style={{ animationDelay: "300ms" }} />
        </div>
        <p className="text-muted-foreground">Loading your Project Wrapped...</p>
      </div>
    </div>
  );
}

function ErrorState({ error }: { error: Error }) {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-6 py-16 relative">
      <div className="absolute inset-0 bg-gradient-to-br from-destructive/10 via-transparent to-accent/10 pointer-events-none" />
      <div className="relative z-10 text-center max-w-2xl mx-auto">
        <div className="w-16 h-16 rounded-full bg-destructive/20 flex items-center justify-center mx-auto mb-6">
          <span className="text-3xl">!</span>
        </div>
        <h2 className="text-3xl font-bold mb-4">Unable to load data</h2>
        <p className="text-muted-foreground mb-6">
          {error.message || "Something went wrong while loading your Project Wrapped."}
        </p>
      </div>
    </div>
  );
}

export default function ProjectWrapped() {
  const { data, isLoading, error } = useQuery<ProjectWrappedData>({
    queryKey: ["/api/wrapped"],
  });

  const activeSection = useActiveSection(sectionIds);

  if (isLoading) {
    return <LoadingState />;
  }

  if (error) {
    return <ErrorState error={error as Error} />;
  }

  if (!data) {
    return <ErrorState error={new Error("No data available")} />;
  }

  return (
    <div className="min-h-screen bg-background text-foreground scroll-smooth" data-testid="project-wrapped">
      <NavigationDots
        sections={sectionNames}
        activeSection={activeSection}
        onDotClick={(index) => scrollToSection(index, sectionIds)}
      />

      <IntroSlide data={data} />
      <GlobalStatsSlide stats={data.stats} />
      <ChampionsSlide contributors={data.contributors} />
      <Top5Slide top5={data.top5} />
      <ModulesSlide modules={data.modules} />
      <TimelineSlide
        milestones={data.milestones}
        dateRange={data.dateRange}
        sprintsCompleted={data.stats.sprintsCompleted}
      />
      <HighlightsSlide highlights={data.highlights} />
      <OutroSlide data={data} />
    </div>
  );
}
