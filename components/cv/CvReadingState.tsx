"use client";

import { useEffect, useState } from "react";
import { he } from "@/lib/i18n/he";

export type PartialOutput = {
  reflection_he?: string;
  skills?: Array<{ id?: string; confidence?: number; evidence?: string } | undefined>;
  other_skills?: Array<string | undefined>;
};

const SCANNING_MESSAGES = [
  he.cv.reading.scanningTechnical,
  he.cv.reading.scanningSocial,
  he.cv.reading.scanningManagerial,
  he.cv.reading.scanningAnalytical,
];

export function CvReadingState({
  filename,
  partial,
  isLoading,
  isUploading,
}: {
  filename: string;
  partial: PartialOutput | null;
  isLoading: boolean;
  isUploading: boolean;
}) {
  const reflection = partial?.reflection_he ?? "";
  const skills = (partial?.skills ?? []).filter(
    (s): s is { id: string; confidence?: number; evidence?: string } =>
      s !== undefined && typeof s.id === "string",
  );

  const [scanIndex, setScanIndex] = useState(0);
  useEffect(() => {
    if (!isLoading) return;
    const t = setInterval(() => setScanIndex((i) => (i + 1) % SCANNING_MESSAGES.length), 2000);
    return () => clearInterval(t);
  }, [isLoading]);

  const status = isUploading
    ? he.cv.reading.uploading
    : reflection
      ? SCANNING_MESSAGES[scanIndex]
      : he.cv.reading.parsing;

  return (
    <div className="mx-auto max-w-2xl space-y-6 py-10">
      <header className="flex items-center justify-between text-sm text-muted-foreground">
        <span className="truncate">{filename}</span>
        <span className="flex items-center gap-2">
          <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-primary" aria-hidden />
          {status}
        </span>
      </header>

      <div
        className="min-h-[7rem] rounded-2xl border bg-card p-6 text-lg leading-relaxed"
        aria-live="polite"
      >
        {reflection ? (
          <span className="text-foreground">{reflection}</span>
        ) : (
          <span className="text-muted-foreground">{he.cv.reading.noReflectionYet}</span>
        )}
      </div>

      {skills.length > 0 && (
        <div className="text-sm text-muted-foreground">
          {he.cv.reading.counter.replace("{n}", String(skills.length))}
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        {skills.map((skill, i) => (
          <SkillCardSkeleton key={`${skill.id}-${i}`} skill={skill} index={i} />
        ))}
      </div>
    </div>
  );
}

function SkillCardSkeleton({
  skill,
  index,
}: {
  skill: { id: string; confidence?: number; evidence?: string };
  index: number;
}) {
  const confidence = skill.confidence ?? 0;
  const isHigh = confidence >= 0.8;
  const isMid = confidence >= 0.5 && confidence < 0.8;
  const dotColor = isHigh
    ? "bg-emerald-500"
    : isMid
      ? "bg-amber-500"
      : "bg-muted-foreground/50";

  return (
    <div
      className="rounded-xl border bg-card p-4 transition-[transform,opacity] duration-200 ease-out"
      style={{
        animation: `slide-up 200ms ease-out ${Math.min(index * 30, 600)}ms both`,
      }}
    >
      <div className="flex items-center gap-2">
        <span className={`inline-block h-2 w-2 rounded-full ${dotColor}`} aria-hidden />
        <span className="text-base font-semibold">{skill.id.startsWith("other:") ? skill.id.slice(6) : skill.id}</span>
      </div>
      {skill.evidence && (
        <p className="mt-2 text-xs text-muted-foreground" dir="auto">{skill.evidence}</p>
      )}
      <style>{`
        @keyframes slide-up {
          from { opacity: 0; transform: translateY(8px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}
