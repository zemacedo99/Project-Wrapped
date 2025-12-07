import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useParams, Link } from "wouter";
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
import { Button } from "@/components/ui/button";
import { Home, Share2, Download, Image, FileText, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import html2canvas from "html2canvas";

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
        <Link href="/">
          <Button variant="outline" data-testid="button-go-home">
            <Home className="w-4 h-4 mr-2" />
            Back to Home
          </Button>
        </Link>
      </div>
    </div>
  );
}

export default function ProjectWrapped() {
  const params = useParams<{ id: string }>();
  const { toast } = useToast();
  const wrappedId = params.id;
  const [showExportDialog, setShowExportDialog] = useState(false);
  const [isExporting, setIsExporting] = useState(false);

  const { data, isLoading, error } = useQuery<ProjectWrappedData>({
    queryKey: ["/api/wrapped", wrappedId],
    queryFn: async () => {
      const response = await fetch(`/api/wrapped/${wrappedId}`);
      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error || "Failed to load data");
      }
      return response.json();
    },
    enabled: !!wrappedId,
  });

  const activeSection = useActiveSection(sectionIds);

  const handleShare = async () => {
    const shareUrl = window.location.href;
    try {
      await navigator.clipboard.writeText(shareUrl);
      toast({
        title: "Link copied!",
        description: "Share this link with your team",
      });
    } catch {
      toast({
        title: "Copy failed",
        description: "Please copy the URL manually",
        variant: "destructive",
      });
    }
  };

  const handleExportCurrentSlide = async () => {
    if (!data) return;
    setIsExporting(true);
    
    try {
      const currentSlideId = sectionIds[activeSection];
      const slideElement = document.querySelector(`[data-testid="${currentSlideId}"]`) as HTMLElement | null;
      
      if (!slideElement) {
        throw new Error("Could not find current slide");
      }

      const canvas = await html2canvas(slideElement, {
        backgroundColor: null,
        scale: 2,
        logging: false,
        useCORS: true,
      });

      const link = document.createElement("a");
      link.download = `${data.projectName.replace(/[^a-z0-9]/gi, '-')}-${sectionNames[activeSection]}.png`;
      link.href = canvas.toDataURL("image/png");
      link.click();

      toast({
        title: "Image exported!",
        description: `${sectionNames[activeSection]} slide saved as PNG`,
      });
      setShowExportDialog(false);
    } catch (err) {
      toast({
        title: "Export failed",
        description: err instanceof Error ? err.message : "Could not export image",
        variant: "destructive",
      });
    } finally {
      setIsExporting(false);
    }
  };

  const handleExportAllSlides = async () => {
    if (!data) return;
    setIsExporting(true);
    
    try {
      let exportedCount = 0;
      for (let i = 0; i < sectionIds.length; i++) {
        const slideElement = document.querySelector(`[data-testid="${sectionIds[i]}"]`) as HTMLElement | null;
        if (!slideElement) continue;

        const canvas = await html2canvas(slideElement, {
          backgroundColor: null,
          scale: 2,
          logging: false,
          useCORS: true,
        });

        const link = document.createElement("a");
        link.download = `${data.projectName.replace(/[^a-z0-9]/gi, '-')}-${String(i + 1).padStart(2, '0')}-${sectionNames[i]}.png`;
        link.href = canvas.toDataURL("image/png");
        link.click();
        exportedCount++;

        await new Promise(resolve => setTimeout(resolve, 300));
      }

      if (exportedCount === 0) {
        throw new Error("No slides could be exported");
      }

      toast({
        title: "Slides exported!",
        description: `${exportedCount} images saved as PNG files`,
      });
      setShowExportDialog(false);
    } catch (err) {
      toast({
        title: "Export failed",
        description: err instanceof Error ? err.message : "Could not export images",
        variant: "destructive",
      });
    } finally {
      setIsExporting(false);
    }
  };

  const handlePrintPDF = () => {
    window.print();
    setShowExportDialog(false);
  };

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
      <div className="fixed top-4 left-4 z-50 flex items-center gap-2">
        <Link href="/">
          <Button size="icon" variant="outline" data-testid="button-home">
            <Home className="w-4 h-4" />
          </Button>
        </Link>
        <Button size="icon" variant="outline" onClick={handleShare} data-testid="button-share">
          <Share2 className="w-4 h-4" />
        </Button>
        <Button size="icon" variant="outline" onClick={() => setShowExportDialog(true)} data-testid="button-export">
          <Download className="w-4 h-4" />
        </Button>
      </div>

      <Dialog open={showExportDialog} onOpenChange={setShowExportDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Download className="w-5 h-5" />
              Export Wrapped
            </DialogTitle>
            <DialogDescription>
              Choose how you'd like to export your Project Wrapped
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 pt-4">
            <Button
              className="w-full justify-start gap-3"
              variant="outline"
              onClick={handleExportCurrentSlide}
              disabled={isExporting}
              data-testid="button-export-current"
            >
              {isExporting ? (
                <Loader2 className="w-5 h-5 animate-spin" />
              ) : (
                <Image className="w-5 h-5" />
              )}
              <div className="text-left">
                <div className="font-medium">Export Current Slide</div>
                <div className="text-xs text-muted-foreground">Save "{sectionNames[activeSection]}" as PNG image</div>
              </div>
            </Button>
            <Button
              className="w-full justify-start gap-3"
              variant="outline"
              onClick={handleExportAllSlides}
              disabled={isExporting}
              data-testid="button-export-all"
            >
              {isExporting ? (
                <Loader2 className="w-5 h-5 animate-spin" />
              ) : (
                <Image className="w-5 h-5" />
              )}
              <div className="text-left">
                <div className="font-medium">Export All Slides</div>
                <div className="text-xs text-muted-foreground">Download all 8 slides as PNG images</div>
              </div>
            </Button>
            <Button
              className="w-full justify-start gap-3"
              variant="outline"
              onClick={handlePrintPDF}
              disabled={isExporting}
              data-testid="button-export-pdf"
            >
              <FileText className="w-5 h-5" />
              <div className="text-left">
                <div className="font-medium">Print / Save as PDF</div>
                <div className="text-xs text-muted-foreground">Use browser print dialog to save as PDF</div>
              </div>
            </Button>
          </div>
        </DialogContent>
      </Dialog>

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
      <HighlightsSlide highlights={data.highlights} funFacts={data.funFacts} />
      <OutroSlide data={data} />
    </div>
  );
}
