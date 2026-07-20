import { useIntersectionObserver } from "@/hooks/use-intersection-observer";
import type { Module } from "@shared/schema";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Layers, Target, Flame, CheckCircle, AlertCircle, Clock, Bug, ClipboardList, Users } from "lucide-react";

interface ModulesSlideProps {
  modules: Module[];
  showStoryPoints?: boolean;
}

function getStatusConfig(status: string) {
  const statusLower = status.toLowerCase();
  if (statusLower.includes("complete") || statusLower.includes("done")) {
    return {
      icon: <CheckCircle className="w-4 h-4" />,
      color: "bg-chart-2/20 text-chart-2 border-chart-2/30",
    };
  }
  if (statusLower.includes("progress") || statusLower.includes("active")) {
    return {
      icon: <Clock className="w-4 h-4" />,
      color: "bg-chart-3/20 text-chart-3 border-chart-3/30",
    };
  }
  if (statusLower.includes("blocked") || statusLower.includes("issue")) {
    return {
      icon: <AlertCircle className="w-4 h-4" />,
      color: "bg-destructive/20 text-destructive border-destructive/30",
    };
  }
  return {
    icon: <Layers className="w-4 h-4" />,
    color: "bg-muted text-muted-foreground border-muted",
  };
}

function findMostActiveModule(modules: Module[]): Module | undefined {
  if (modules.length === 0) return undefined;
  return modules.reduce((prev, current) => {
    const prevActivity = (prev.workItems || 0) + prev.storyPointsDone;
    const currentActivity = (current.workItems || 0) + current.storyPointsDone;
    return currentActivity > prevActivity ? current : prev;
  });
}

interface ModuleCardProps {
  module: Module;
  isMostActive: boolean;
  delay: number;
  isVisible: boolean;
  showStoryPoints: boolean;
}

function ModuleCard({ module, isMostActive, delay, isVisible, showStoryPoints }: ModuleCardProps) {
  const statusConfig = getStatusConfig(module.status);
  const testId = module.name.toLowerCase().replace(/\s+/g, "-");

  return (
    <Card
      data-testid={`module-card-${testId}`}
      className={`relative p-6 bg-card/40 backdrop-blur-sm border-white/10 transition-all duration-700 hover-elevate ${
        isVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-8"
      } ${isMostActive ? "ring-2 ring-chart-4/50" : ""}`}
      style={{ transitionDelay: `${delay}ms` }}
    >
      {isMostActive && (
        <div className="absolute -top-3 -right-3">
          <div className="flex items-center gap-1 px-3 py-1 rounded-full bg-gradient-to-r from-chart-4 to-accent text-white text-xs font-bold shadow-lg">
            <Flame className="w-3 h-3" />
            Most Active
          </div>
        </div>
      )}

      <div className="flex items-start justify-between mb-4 gap-4">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-gradient-to-br from-primary/20 to-accent/10">
            <Layers className="w-5 h-5 text-primary" />
          </div>
          <h3 className="text-lg font-bold">{module.name}</h3>
        </div>
        <Badge className={`${statusConfig.color} border flex items-center gap-1`}>
          {statusConfig.icon}
          {module.status}
        </Badge>
      </div>

      <div className={`grid gap-4 ${showStoryPoints ? "grid-cols-3" : "grid-cols-2"}`}>
        <div className="text-center p-3 rounded-lg bg-white/5">
          <div className="flex items-center justify-center mb-1">
            <ClipboardList className="w-4 h-4 text-primary" />
          </div>
          <p className="text-2xl font-bold tabular-nums">{(module.workItems || 0).toLocaleString()}</p>
          <p className="text-xs text-muted-foreground">Work Items</p>
        </div>
        {showStoryPoints && (
          <div className="text-center p-3 rounded-lg bg-white/5">
            <div className="flex items-center justify-center mb-1">
              <Target className="w-4 h-4 text-chart-2" />
            </div>
            <p className="text-2xl font-bold tabular-nums">{module.storyPointsDone.toLocaleString()}</p>
            <p className="text-xs text-muted-foreground">Points</p>
          </div>
        )}
        <div className="text-center p-3 rounded-lg bg-white/5">
          <div className="flex items-center justify-center mb-1">
            {module.bugsFixed && module.bugsFixed > 0 ? (
              <Bug className="w-4 h-4 text-destructive" />
            ) : (
              <Users className="w-4 h-4 text-accent" />
            )}
          </div>
          {module.bugsFixed && module.bugsFixed > 0 ? (
            <>
              <p className="text-2xl font-bold tabular-nums">{module.bugsFixed.toLocaleString()}</p>
              <p className="text-xs text-muted-foreground">Bugs Fixed</p>
            </>
          ) : (
            <>
              <p className="text-2xl font-bold tabular-nums">{(module.contributors || 0).toLocaleString()}</p>
              <p className="text-xs text-muted-foreground">Contributors</p>
            </>
          )}
        </div>
      </div>
    </Card>
  );
}

export function ModulesSlide({ modules, showStoryPoints = false }: ModulesSlideProps) {
  const [ref, isVisible] = useIntersectionObserver<HTMLElement>({ threshold: 0.15 });
  const mostActiveModule = findMostActiveModule(modules);

  if (modules.length === 0) return null;

  return (
    <section
      ref={ref}
      data-testid="slide-modules"
      className="min-h-screen flex flex-col items-center justify-center px-6 py-16 relative"
    >
      <div className="absolute inset-0 bg-gradient-to-br from-chart-2/5 via-transparent to-chart-3/5 pointer-events-none" />

      <div className="relative z-10 max-w-6xl mx-auto w-full">
        <div
          className={`text-center mb-12 transition-all duration-700 ${
            isVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-8"
          }`}
        >
          <div className="flex items-center justify-center gap-3 mb-4">
            <Layers className="w-8 h-8 text-primary" />
            <h2 className="text-4xl md:text-5xl lg:text-6xl font-black">
              Work Areas
            </h2>
          </div>
          <p className="text-xl text-muted-foreground">
            Grouped by work item Area Path — not code modules or repositories
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {modules.map((module, index) => (
            <ModuleCard
              key={module.name}
              module={module}
              isMostActive={mostActiveModule?.name === module.name}
              delay={index * 100}
              isVisible={isVisible}
              showStoryPoints={showStoryPoints}
            />
          ))}
        </div>
      </div>
    </section>
  );
}
