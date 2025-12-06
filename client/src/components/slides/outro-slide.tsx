import { useIntersectionObserver } from "@/hooks/use-intersection-observer";
import type { ProjectWrappedData } from "@shared/schema";
import { Button } from "@/components/ui/button";
import { Heart, Share2, Sparkles, PartyPopper } from "lucide-react";

interface OutroSlideProps {
  data: ProjectWrappedData;
}

export function OutroSlide({ data }: OutroSlideProps) {
  const [ref, isVisible] = useIntersectionObserver<HTMLElement>({ threshold: 0.3 });

  return (
    <section
      ref={ref}
      data-testid="slide-outro"
      className="min-h-screen flex flex-col items-center justify-center px-6 py-16 relative overflow-hidden"
    >
      <div className="absolute inset-0 bg-gradient-to-br from-primary/20 via-accent/10 to-chart-2/20 pointer-events-none" />
      <div className="absolute top-0 left-1/4 w-96 h-96 bg-primary/20 rounded-full blur-3xl pointer-events-none animate-pulse" />
      <div className="absolute bottom-0 right-1/4 w-96 h-96 bg-accent/20 rounded-full blur-3xl pointer-events-none animate-pulse" style={{ animationDelay: "1s" }} />
      <div className="absolute top-1/2 left-0 w-72 h-72 bg-chart-2/10 rounded-full blur-3xl pointer-events-none" />

      <div className="relative z-10 text-center max-w-3xl mx-auto">
        <div
          className={`mb-8 transition-all duration-700 ${
            isVisible ? "opacity-100 scale-100" : "opacity-0 scale-90"
          }`}
        >
          <div className="flex items-center justify-center gap-4 mb-6">
            <PartyPopper className="w-12 h-12 text-chart-4 animate-float" />
            <Sparkles className="w-10 h-10 text-primary animate-float" style={{ animationDelay: "0.5s" }} />
            <PartyPopper className="w-12 h-12 text-accent animate-float" style={{ animationDelay: "1s" }} />
          </div>
        </div>

        <h2
          className={`text-5xl md:text-6xl lg:text-7xl font-black mb-6 transition-all duration-700 delay-100 ${
            isVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-8"
          }`}
        >
          <span className="bg-gradient-to-r from-primary via-accent to-chart-2 bg-clip-text text-transparent">
            That was {data.projectName}
          </span>
        </h2>

        <h3
          className={`text-3xl md:text-4xl font-bold text-foreground mb-8 transition-all duration-700 delay-200 ${
            isVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-8"
          }`}
        >
          Version {data.version}
        </h3>

        <p
          className={`text-xl md:text-2xl text-muted-foreground mb-12 transition-all duration-700 delay-300 ${
            isVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-8"
          }`}
        >
          Thanks for all the commits, reviews, and comments.
          <br />
          <span className="flex items-center justify-center gap-2 mt-2">
            Built with <Heart className="w-5 h-5 text-destructive inline animate-pulse" /> by the team
          </span>
        </p>

        <div
          className={`flex flex-col sm:flex-row items-center justify-center gap-4 transition-all duration-700 delay-400 ${
            isVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-8"
          }`}
        >
          <Button
            size="lg"
            className="bg-gradient-to-r from-primary to-accent text-white border-0 px-8"
            data-testid="button-share"
          >
            <Share2 className="w-5 h-5 mr-2" />
            Share this (coming soon)
          </Button>
        </div>

        <div
          className={`mt-16 pt-8 border-t border-white/10 transition-all duration-700 delay-500 ${
            isVisible ? "opacity-100" : "opacity-0"
          }`}
        >
          <p className="text-sm text-muted-foreground">
            {data.projectName} {data.version} • Project Wrapped
          </p>
        </div>
      </div>
    </section>
  );
}
