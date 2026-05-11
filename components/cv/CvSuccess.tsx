"use client";

import { Button } from "@/components/ui/button";
import { he } from "@/lib/i18n/he";
import type { Archetype } from "@/lib/cv/archetype";

export function CvSuccess({
  skillCount,
  archetype,
  onViewRecommendations,
  onReUpload,
}: {
  skillCount: number;
  archetype: string;
  onViewRecommendations: () => void;
  onReUpload: () => void;
}) {
  const archetypeKey = archetype as Archetype;
  const archetypeName = he.cv.success.archetypeNames[archetypeKey] ?? he.cv.success.archetypeNames.generalist;

  return (
    <div className="mx-auto flex min-h-[60vh] max-w-xl flex-col items-center justify-center space-y-8 py-12 text-center">
      <div
        className="flex h-20 w-20 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-500"
        style={{ animation: "scale-in 400ms ease-out both" }}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="h-10 w-10" aria-hidden>
          <path
            d="M5 13l4 4L19 7"
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{
              strokeDasharray: 24,
              strokeDashoffset: 24,
              animation: "draw-check 400ms ease-out 200ms forwards",
            }}
          />
        </svg>
      </div>

      <div className="space-y-3">
        <h1 className="text-2xl font-bold">
          {he.cv.success.title.replace("{n}", String(skillCount))}
        </h1>
        <div className="space-y-1">
          <p className="text-sm text-muted-foreground">{he.cv.success.archetypeLabel}</p>
          <p className="text-xl font-semibold text-primary">{archetypeName}</p>
        </div>
      </div>

      <div className="flex w-full flex-col gap-2 sm:flex-row sm:justify-center">
        <Button size="lg" onClick={onViewRecommendations} className="w-full sm:w-auto">
          {he.cv.success.cta}
        </Button>
        <Button variant="ghost" size="lg" onClick={onReUpload} className="w-full sm:w-auto">
          {he.cv.success.reUpload}
        </Button>
      </div>

      <style>{`
        @keyframes scale-in {
          from { opacity: 0; transform: scale(0.7); }
          to { opacity: 1; transform: scale(1); }
        }
        @keyframes draw-check {
          to { stroke-dashoffset: 0; }
        }
      `}</style>
    </div>
  );
}
