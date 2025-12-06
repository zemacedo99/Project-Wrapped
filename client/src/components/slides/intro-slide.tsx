import { useIntersectionObserver } from "@/hooks/use-intersection-observer";
import type { ProjectWrappedData } from "@shared/schema";
import { Sparkles, Calendar } from "lucide-react";

interface IntroSlideProps {
  data: ProjectWrappedData;
}

function formatDateRange(start: string, end: string): string {
  const startDate = new Date(start);
  const endDate = new Date(end);
  const options: Intl.DateTimeFormatOptions = { year: "numeric", month: "short" };
  return `${startDate.toLocaleDateString("en-US", options)} – ${endDate.toLocaleDateString("en-US", options)}`;
}

export function IntroSlide({ data }: IntroSlideProps) {
  const [ref, isVisible] = useIntersectionObserver<HTMLElement>({ threshold: 0.3 });

  return (
    <section
      ref={ref}
      data-testid="slide-intro"
      className="min-h-screen flex flex-col items-center justify-center px-6 py-16 relative overflow-hidden"
    >
      <div className="absolute inset-0 bg-gradient-to-br from-primary/20 via-transparent to-accent/20 pointer-events-none" />
      <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-primary/10 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-accent/10 rounded-full blur-3xl pointer-events-none" />

      <div className="relative z-10 text-center max-w-4xl mx-auto">
        <div
          className={`transition-all duration-700 ${
            isVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-8"
          }`}
        >
          <div className="flex items-center justify-center gap-2 mb-6">
            <Sparkles className="w-6 h-6 text-primary animate-pulse" />
            <span className="text-sm font-medium uppercase tracking-widest text-muted-foreground">
              Year in Review
            </span>
            <Sparkles className="w-6 h-6 text-accent animate-pulse" />
          </div>
        </div>

        <h1
          className={`text-5xl md:text-7xl lg:text-8xl font-black mb-6 transition-all duration-700 delay-100 ${
            isVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-8"
          }`}
        >
          <span className="bg-gradient-to-r from-primary via-accent to-primary bg-[length:200%_auto] bg-clip-text text-transparent animate-gradient-shift">
            Project Wrapped
          </span>
        </h1>

        <h2
          className={`text-2xl md:text-3xl lg:text-4xl font-bold text-foreground mb-4 transition-all duration-700 delay-200 ${
            isVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-8"
          }`}
        >
          {data.projectName}
          <span className="ml-3 text-primary">{data.version}</span>
        </h2>

        <div
          className={`flex items-center justify-center gap-2 text-lg text-muted-foreground mb-12 transition-all duration-700 delay-300 ${
            isVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-8"
          }`}
        >
          <Calendar className="w-5 h-5" />
          <span>{formatDateRange(data.dateRange.start, data.dateRange.end)}</span>
        </div>

        <p
          className={`text-xl md:text-2xl text-muted-foreground max-w-2xl mx-auto transition-all duration-700 delay-400 ${
            isVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-8"
          }`}
        >
          A look back at what it took to ship {data.version}
        </p>

        <div
          className={`mt-16 transition-all duration-700 delay-500 ${
            isVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-8"
          }`}
        >
          <div className="animate-bounce">
            <svg
              className="w-8 h-8 mx-auto text-muted-foreground"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M19 14l-7 7m0 0l-7-7m7 7V3"
              />
            </svg>
          </div>
          <p className="text-sm text-muted-foreground mt-2">Scroll to explore</p>
        </div>
      </div>
    </section>
  );
}
