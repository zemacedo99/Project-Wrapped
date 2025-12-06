import { useIntersectionObserver } from "@/hooks/use-intersection-observer";
import type { Module } from "@shared/schema";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Layers, GitCommit, GitPullRequest, Target, Flame, CheckCircle, AlertCircle, Clock } from "lucide-react";

interface ModulesSlideProps {
  modules: Module[];
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
    const prevActivity = prev.commits + prev.pullRequests + prev.storyPointsDone;
    const currentActivity = current.commits + current.pullRequests + current.storyPointsDone;
    return currentActivity > prevActivity ? current : prev;
  });
}

interface ModuleCardProps {
  module: Module;
  isMostActive: boolean;
  delay: number;
  isVisible: boolean;
}

function ModuleCard({ module, isMostActive, delay, isVisible }: ModuleCardProps) {
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

      <div className="grid grid-cols-3 gap-4">
        <div className="text-center p-3 rounded-lg bg-white/5">
          <div className="flex items-center justify-center mb-1">
            <GitCommit className="w-4 h-4 text-primary" />
          </div>
          <p className="text-2xl font-bold tabular-nums">{module.commits.toLocaleString()}</p>
          <p className="text-xs text-muted-foreground">Commits</p>
        </div>
        <div className="text-center p-3 rounded-lg bg-white/5">
          <div className="flex items-center justify-center mb-1">
            <GitPullRequest className="w-4 h-4 text-accent" />
          </div>
          <p className="text-2xl font-bold tabular-nums">{module.pullRequests.toLocaleString()}</p>
          <p className="text-xs text-muted-foreground">PRs</p>
        </div>
        <div className="text-center p-3 rounded-lg bg-white/5">
          <div className="flex items-center justify-center mb-1">
            <Target className="w-4 h-4 text-chart-2" />
          </div>
          <p className="text-2xl font-bold tabular-nums">{module.storyPointsDone.toLocaleString()}</p>
          <p className="text-xs text-muted-foreground">Points</p>
        </div>
      </div>
    </Card>
  );
}

export function ModulesSlide({ modules }: ModulesSlideProps) {
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
              Modules & Components
            </h2>
          </div>
          <p className="text-xl text-muted-foreground">
            Where the work happened across the codebase
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
            />
          ))}
        </div>
      </div>
    </section>
  );
}
