import { useIntersectionObserver } from "@/hooks/use-intersection-observer";
import type { Milestone } from "@shared/schema";
import { Rocket, Flag, Lightbulb, RefreshCw, Lock, PartyPopper } from "lucide-react";

interface TimelineSlideProps {
  milestones: Milestone[];
  dateRange: { start: string; end: string };
  sprintsCompleted: number;
}

function getIconComponent(iconName: string) {
  const icons: Record<string, React.ReactNode> = {
    rocket: <Rocket className="w-6 h-6" />,
    flag: <Flag className="w-6 h-6" />,
    lightbulb: <Lightbulb className="w-6 h-6" />,
    refresh: <RefreshCw className="w-6 h-6" />,
    lock: <Lock className="w-6 h-6" />,
    party: <PartyPopper className="w-6 h-6" />,
  };
  return icons[iconName] || <Flag className="w-6 h-6" />;
}

function getGradientByIndex(index: number) {
  const gradients = [
    "from-primary to-accent",
    "from-chart-3 to-chart-2",
    "from-chart-4 to-accent",
    "from-accent to-primary",
    "from-chart-2 to-chart-3",
    "from-primary to-chart-4",
  ];
  return gradients[index % gradients.length];
}

function formatDate(dateString: string): string {
  const date = new Date(dateString);
  return date.toLocaleDateString("en-US", { month: "short", year: "numeric" });
}

export function TimelineSlide({ milestones, dateRange, sprintsCompleted }: TimelineSlideProps) {
  const [ref, isVisible] = useIntersectionObserver<HTMLElement>({ threshold: 0.15 });

  return (
    <section
      ref={ref}
      data-testid="slide-timeline"
      className="min-h-screen flex flex-col items-center justify-center px-6 py-16 relative overflow-hidden"
    >
      <div className="absolute inset-0 bg-gradient-to-b from-primary/5 via-transparent to-accent/5 pointer-events-none" />
      <div className="absolute top-0 left-1/2 w-px h-full bg-gradient-to-b from-transparent via-white/10 to-transparent pointer-events-none" />

      <div className="relative z-10 max-w-4xl mx-auto w-full">
        <div
          className={`text-center mb-16 transition-all duration-700 ${
            isVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-8"
          }`}
        >
          <h2 className="text-4xl md:text-5xl lg:text-6xl font-black mb-4">
            The Journey
          </h2>
          <p className="text-xl text-muted-foreground mb-2">
            {formatDate(dateRange.start)} to {formatDate(dateRange.end)}
          </p>
          <p className="text-lg text-muted-foreground">
            {sprintsCompleted} sprints of building, breaking, and shipping
          </p>
        </div>

        <div className="relative">
          <div className="absolute left-1/2 transform -translate-x-1/2 w-1 h-full bg-gradient-to-b from-primary via-accent to-chart-2 rounded-full" />

          <div className="space-y-12">
            {milestones.map((milestone, index) => {
              const isLeft = index % 2 === 0;
              const gradient = getGradientByIndex(index);

              return (
                <div
                  key={`${milestone.title}-${index}`}
                  data-testid={`timeline-milestone-${index}`}
                  className={`relative flex items-center ${
                    isLeft ? "flex-row" : "flex-row-reverse"
                  }`}
                >
                  <div
                    className={`w-5/12 ${isLeft ? "text-right pr-8" : "text-left pl-8"}`}
                  >
                    <div
                      className={`transition-all duration-700 ${
                        isVisible ? "opacity-100 translate-x-0" : `opacity-0 ${isLeft ? "-translate-x-8" : "translate-x-8"}`
                      }`}
                      style={{ transitionDelay: `${index * 150}ms` }}
                    >
                      <p className="text-sm font-medium text-muted-foreground mb-1">
                        {formatDate(milestone.date)}
                      </p>
                      <h3 className="text-xl font-bold mb-2">{milestone.title}</h3>
                      <p className="text-muted-foreground">{milestone.description}</p>
                    </div>
                  </div>

                  <div className="absolute left-1/2 transform -translate-x-1/2 z-10">
                    <div
                      className={`w-14 h-14 rounded-full bg-gradient-to-br ${gradient} flex items-center justify-center text-white shadow-lg transition-all duration-700 ${
                        isVisible ? "opacity-100 scale-100" : "opacity-0 scale-0"
                      }`}
                      style={{ transitionDelay: `${index * 150 + 100}ms` }}
                    >
                      {getIconComponent(milestone.icon)}
                    </div>
                  </div>

                  <div className="w-5/12" />
                </div>
              );
            })}
          </div>

          <div
            className={`absolute left-1/2 transform -translate-x-1/2 -bottom-8 transition-all duration-700 ${
              isVisible ? "opacity-100 scale-100" : "opacity-0 scale-0"
            }`}
            style={{ transitionDelay: `${milestones.length * 150 + 200}ms` }}
          >
            <div className="w-6 h-6 rounded-full bg-chart-2 shadow-lg animate-pulse" />
          </div>
        </div>
      </div>
    </section>
  );
}
