import { useEffect, useState } from "react";

interface NavigationDotsProps {
  sections: string[];
  activeSection: number;
  onDotClick: (index: number) => void;
}

export function NavigationDots({ sections, activeSection, onDotClick }: NavigationDotsProps) {
  return (
    <div className="fixed right-6 top-1/2 -translate-y-1/2 z-50 hidden lg:flex flex-col gap-3">
      {sections.map((section, index) => (
        <button
          key={section}
          onClick={() => onDotClick(index)}
          className="group relative flex items-center justify-end"
          data-testid={`nav-dot-${index}`}
          aria-label={`Go to ${section}`}
        >
          <span className="absolute right-8 px-3 py-1 rounded-md bg-card/90 backdrop-blur-sm text-sm font-medium opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap border border-white/10">
            {section}
          </span>
          <div
            className={`w-3 h-3 rounded-full transition-all duration-300 ${
              activeSection === index
                ? "bg-gradient-to-r from-primary to-accent scale-125"
                : "bg-white/30 hover:bg-white/50"
            }`}
          />
        </button>
      ))}
    </div>
  );
}

export function useActiveSection(sectionIds: string[]): number {
  const [activeSection, setActiveSection] = useState(0);

  useEffect(() => {
    const observers: IntersectionObserver[] = [];

    sectionIds.forEach((id, index) => {
      const element = document.querySelector(`[data-testid="${id}"]`);
      if (!element) return;

      const observer = new IntersectionObserver(
        ([entry]) => {
          if (entry.isIntersecting) {
            setActiveSection(index);
          }
        },
        { threshold: 0.5 }
      );

      observer.observe(element);
      observers.push(observer);
    });

    return () => {
      observers.forEach((observer) => observer.disconnect());
    };
  }, [sectionIds]);

  return activeSection;
}

export function scrollToSection(index: number, sectionIds: string[]) {
  const sectionId = sectionIds[index];
  const element = document.querySelector(`[data-testid="${sectionId}"]`);
  if (element) {
    element.scrollIntoView({ behavior: "smooth" });
  }
}
