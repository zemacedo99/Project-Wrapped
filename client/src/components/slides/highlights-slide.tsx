import { useIntersectionObserver } from "@/hooks/use-intersection-observer";
import { Card } from "@/components/ui/card";
import { Rocket, Bug, Flame, Target, Trophy, Star, Zap, Shield, CheckCircle, Award, Lightbulb, Coffee, Moon, Sun, Calendar, TrendingUp } from "lucide-react";

interface HighlightsSlideProps {
  highlights: string[];
  funFacts?: string[];
}

function getHighlightIcon(index: number) {
  const icons = [
    <Rocket className="w-6 h-6" />,
    <Bug className="w-6 h-6" />,
    <Flame className="w-6 h-6" />,
    <Target className="w-6 h-6" />,
    <Trophy className="w-6 h-6" />,
    <Star className="w-6 h-6" />,
    <Zap className="w-6 h-6" />,
    <Shield className="w-6 h-6" />,
    <CheckCircle className="w-6 h-6" />,
    <Award className="w-6 h-6" />,
  ];
  return icons[index % icons.length];
}

function getFunFactIcon(text: string, index: number) {
  // Match icons based on fun fact content
  if (text.includes("Night") || text.includes("🦉") || text.includes("night")) return <Moon className="w-6 h-6" />;
  if (text.includes("Early") || text.includes("🐦") || text.includes("Morning") || text.includes("☕")) return <Sun className="w-6 h-6" />;
  if (text.includes("streak") || text.includes("🔥")) return <Flame className="w-6 h-6" />;
  if (text.includes("Weekend") || text.includes("day")) return <Calendar className="w-6 h-6" />;
  if (text.includes("fast") || text.includes("⚡") || text.includes("🚀")) return <Zap className="w-6 h-6" />;
  if (text.includes("rate") || text.includes("📈")) return <TrendingUp className="w-6 h-6" />;
  
  const icons = [
    <Lightbulb className="w-6 h-6" />,
    <Coffee className="w-6 h-6" />,
    <Star className="w-6 h-6" />,
  ];
  return icons[index % icons.length];
}

function getGradientByIndex(index: number) {
  const gradients = [
    "from-primary to-accent",
    "from-chart-2 to-chart-3",
    "from-chart-4 to-accent",
    "from-accent to-primary",
    "from-chart-3 to-chart-2",
    "from-primary to-chart-4",
  ];
  return gradients[index % gradients.length];
}

export function HighlightsSlide({ highlights, funFacts }: HighlightsSlideProps) {
  const [ref, isVisible] = useIntersectionObserver<HTMLElement>({ threshold: 0.2 });

  if (highlights.length === 0 && (!funFacts || funFacts.length === 0)) return null;

  return (
    <section
      ref={ref}
      data-testid="slide-highlights"
      className="min-h-screen flex flex-col items-center justify-center px-6 py-16 relative"
    >
      <div className="absolute inset-0 bg-gradient-to-br from-chart-4/10 via-transparent to-primary/10 pointer-events-none" />
      <div className="absolute top-1/4 left-0 w-64 h-64 bg-chart-4/20 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute bottom-1/4 right-0 w-64 h-64 bg-primary/20 rounded-full blur-3xl pointer-events-none" />

      <div className="relative z-10 max-w-5xl mx-auto w-full">
        {/* Highlights Section */}
        {highlights.length > 0 && (
          <>
            <div
              className={`text-center mb-12 transition-all duration-700 ${
                isVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-8"
              }`}
            >
              <div className="flex items-center justify-center gap-3 mb-4">
                <Trophy className="w-8 h-8 text-chart-4" />
                <h2 className="text-4xl md:text-5xl lg:text-6xl font-black">
                  Achievements Unlocked
                </h2>
              </div>
              <p className="text-xl text-muted-foreground">
                The milestones that made this release special
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-16">
              {highlights.map((highlight, index) => {
                const gradient = getGradientByIndex(index);
                return (
                  <Card
                    key={`highlight-${index}`}
                    data-testid={`highlight-card-${index}`}
                    className={`relative p-6 bg-card/40 backdrop-blur-sm border-white/10 overflow-visible transition-all duration-700 hover-elevate ${
                      isVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-8"
                    }`}
                    style={{ transitionDelay: `${index * 100}ms` }}
                  >
                    <div
                      className={`absolute -top-4 -left-2 w-12 h-12 rounded-full bg-gradient-to-br ${gradient} flex items-center justify-center text-white shadow-lg animate-float`}
                      style={{ animationDelay: `${index * 200}ms` }}
                    >
                      {getHighlightIcon(index)}
                    </div>

                    <div className="ml-8">
                      <p className="text-lg font-semibold">{highlight}</p>
                    </div>
                  </Card>
                );
              })}
            </div>
          </>
        )}

        {/* Fun Facts Section */}
        {funFacts && funFacts.length > 0 && (
          <>
            <div
              className={`text-center mb-12 transition-all duration-700 ${
                isVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-8"
              }`}
              style={{ transitionDelay: `${highlights.length * 100 + 200}ms` }}
            >
              <div className="flex items-center justify-center gap-3 mb-4">
                <Lightbulb className="w-8 h-8 text-chart-4" />
                <h3 className="text-3xl md:text-4xl font-bold">
                  Fun Facts
                </h3>
              </div>
              <p className="text-lg text-muted-foreground">
                Behind-the-scenes insights from your codebase
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {funFacts.map((fact, index) => {
                const gradient = getGradientByIndex(index + highlights.length);
                return (
                  <Card
                    key={`funfact-${index}`}
                    data-testid={`funfact-card-${index}`}
                    className={`relative p-5 bg-card/30 backdrop-blur-sm border-white/5 overflow-visible transition-all duration-700 hover:bg-card/50 ${
                      isVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-8"
                    }`}
                    style={{ transitionDelay: `${(highlights.length + index) * 100 + 300}ms` }}
                  >
                    <div className="flex items-center gap-4">
                      <div
                        className={`w-10 h-10 rounded-full bg-gradient-to-br ${gradient} flex items-center justify-center text-white shadow-md`}
                      >
                        {getFunFactIcon(fact, index)}
                      </div>
                      <p className="text-base font-medium flex-1">{fact}</p>
                    </div>
                  </Card>
                );
              })}
            </div>
          </>
        )}
      </div>
    </section>
  );
}
