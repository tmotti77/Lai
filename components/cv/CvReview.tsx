"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { he } from "@/lib/i18n/he";
import type { ExtractedSkill } from "@/lib/cv/types";
import taxonomyJson from "@/content/skills/taxonomy.json";

type TaxonomyEntry = {
  id: string;
  name_he: string;
  category: string;
};

const TAXONOMY = (taxonomyJson as { skills: TaxonomyEntry[] }).skills;
const TAXONOMY_BY_ID = new Map(TAXONOMY.map((s) => [s.id, s]));

const CATEGORY_COLORS: Record<string, string> = {
  technical: "bg-blue-500",
  analytical: "bg-violet-500",
  managerial: "bg-amber-500",
  social: "bg-emerald-500",
  creative: "bg-rose-500",
  soft: "bg-slate-500",
  physical: "bg-orange-500",
};

const CATEGORY_TEXT_COLORS: Record<string, string> = {
  technical: "text-blue-700 dark:text-blue-300",
  analytical: "text-violet-700 dark:text-violet-300",
  managerial: "text-amber-700 dark:text-amber-300",
  social: "text-emerald-700 dark:text-emerald-300",
  creative: "text-rose-700 dark:text-rose-300",
  soft: "text-slate-700 dark:text-slate-300",
  physical: "text-orange-700 dark:text-orange-300",
};

type ReviewSkill = {
  id: string;
  name_he: string;
  confidence: number;
  evidence: string;
  category: string;
  isOther: boolean;
};

export function CvReview({
  reflectionHe,
  skills,
  otherSkills,
  saving,
  saveDisabled,
  onSaveAction,
  onCancelAction,
}: {
  reflectionHe: string;
  skills: ExtractedSkill[];
  otherSkills: string[];
  saving: boolean;
  /** Extra disabled flag for the save button, e.g. when cvUploadId is not yet set. */
  saveDisabled?: boolean;
  onSaveAction: (skillIds: string[]) => void;
  onCancelAction: () => void;
}) {
  // Normalize all skills (taxonomy + other) into one ReviewSkill list.
  const initialList = useMemo<ReviewSkill[]>(() => {
    const list: ReviewSkill[] = [];
    for (const s of skills) {
      if (s.confidence < 0.65) continue;
      if (s.id.startsWith("other:")) {
        const phrase = s.id.slice(6);
        list.push({
          id: s.id,
          name_he: phrase,
          confidence: s.confidence,
          evidence: s.evidence,
          category: "soft",
          isOther: true,
        });
      } else {
        const tax = TAXONOMY_BY_ID.get(s.id);
        if (!tax) {
          // LLM emitted unknown id — surface as other
          list.push({
            id: `other:${s.id}`,
            name_he: s.id,
            confidence: s.confidence,
            evidence: s.evidence,
            category: "soft",
            isOther: true,
          });
          continue;
        }
        list.push({
          id: s.id,
          name_he: tax.name_he,
          confidence: s.confidence,
          evidence: s.evidence,
          category: tax.category,
          isOther: false,
        });
      }
    }
    for (const phrase of otherSkills) {
      const id = `other:${phrase}`;
      if (list.some((s) => s.id === id)) continue;
      list.push({
        id,
        name_he: phrase,
        confidence: 0.7,
        evidence: "",
        category: "soft",
        isOther: true,
      });
    }
    return list;
  }, [skills, otherSkills]);

  const [confirmedIds, setConfirmedIds] = useState<Set<string>>(() => new Set(initialList.map((s) => s.id)));
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [manualSkills, setManualSkills] = useState<ReviewSkill[]>([]);
  const [manualInput, setManualInput] = useState("");

  const allSkills = useMemo(() => [...initialList, ...manualSkills], [initialList, manualSkills]);
  const confirmed = allSkills.filter((s) => confirmedIds.has(s.id));
  const dismissed = allSkills.filter((s) => !confirmedIds.has(s.id));

  const toggle = (id: string) => {
    setConfirmedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const manualSuggestions = useMemo(() => {
    const q = manualInput.trim().toLowerCase();
    if (q.length < 2) return [];
    const taken = new Set(allSkills.map((s) => s.id));
    return TAXONOMY.filter(
      (t) => !taken.has(t.id) && (t.name_he.toLowerCase().includes(q) || t.id.toLowerCase().includes(q)),
    ).slice(0, 6);
  }, [manualInput, allSkills]);

  const addManualTaxonomy = (entry: TaxonomyEntry) => {
    const newSkill: ReviewSkill = {
      id: entry.id,
      name_he: entry.name_he,
      confidence: 1,
      evidence: "",
      category: entry.category,
      isOther: false,
    };
    setManualSkills((prev) => [...prev, newSkill]);
    setConfirmedIds((prev) => new Set(prev).add(entry.id));
    setManualInput("");
  };

  const addManualFreeText = () => {
    const phrase = manualInput.trim();
    if (!phrase) return;
    const id = `other:${phrase}`;
    if (allSkills.some((s) => s.id === id)) {
      setManualInput("");
      return;
    }
    const newSkill: ReviewSkill = {
      id,
      name_he: phrase,
      confidence: 1,
      evidence: "",
      category: "soft",
      isOther: true,
    };
    setManualSkills((prev) => [...prev, newSkill]);
    setConfirmedIds((prev) => new Set(prev).add(id));
    setManualInput("");
  };

  // Category distribution of confirmed skills (excluding "other")
  const distribution = useMemo(() => {
    const dist: Record<string, number> = {};
    for (const s of confirmed) {
      if (s.isOther) continue;
      dist[s.category] = (dist[s.category] ?? 0) + 1;
    }
    return dist;
  }, [confirmed]);

  const totalForMeter = Object.values(distribution).reduce((a, b) => a + b, 0);

  return (
    <div className="mx-auto max-w-3xl space-y-6 pb-32 pt-8">
      {reflectionHe && (
        <div className="rounded-2xl border bg-card p-6 text-lg leading-relaxed">
          {reflectionHe}
        </div>
      )}

      <header className="flex items-center justify-between">
        <h2 className="text-xl font-semibold">{he.cv.review.title}</h2>
        <span className="text-xs text-muted-foreground">{he.cv.review.tapToSee}</span>
      </header>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {confirmed.map((skill) => (
          <SkillCard
            key={skill.id}
            skill={skill}
            expanded={expandedId === skill.id}
            onToggleExpand={() => setExpandedId((prev) => (prev === skill.id ? null : skill.id))}
            onDismiss={() => toggle(skill.id)}
          />
        ))}
      </div>

      <div className="rounded-xl border bg-card p-4">
        <label className="mb-2 block text-sm font-medium">{he.cv.review.addManual}</label>
        <div className="relative">
          <input
            type="text"
            value={manualInput}
            onChange={(e) => setManualInput(e.target.value)}
            placeholder={he.cv.review.addManualPlaceholder}
            className="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                if (manualSuggestions.length > 0) {
                  addManualTaxonomy(manualSuggestions[0]);
                } else {
                  addManualFreeText();
                }
              }
            }}
          />
          {manualInput.trim().length >= 2 && manualSuggestions.length > 0 && (
            <div className="absolute z-10 mt-1 w-full overflow-hidden rounded-md border bg-popover shadow-lg">
              {manualSuggestions.map((sug) => (
                <button
                  key={sug.id}
                  type="button"
                  onClick={() => addManualTaxonomy(sug)}
                  className="flex w-full items-center justify-between px-3 py-2 text-right text-sm hover:bg-accent"
                >
                  <span>{sug.name_he}</span>
                  <span className={`text-xs ${CATEGORY_TEXT_COLORS[sug.category] ?? "text-muted-foreground"}`}>
                    {he.cv.review.categories[sug.category as keyof typeof he.cv.review.categories] ?? sug.category}
                  </span>
                </button>
              ))}
            </div>
          )}
          {manualInput.trim().length >= 2 && manualSuggestions.length === 0 && (
            <div className="absolute z-10 mt-1 w-full rounded-md border bg-popover p-2 text-xs text-muted-foreground">
              {he.cv.review.noMatches} —{" "}
              <button type="button" onClick={addManualFreeText} className="underline">
                {`הוסף "${manualInput.trim()}"`}
              </button>
            </div>
          )}
        </div>
      </div>

      {dismissed.length > 0 && (
        <details className="rounded-xl border bg-muted/30 p-4">
          <summary className="cursor-pointer text-sm font-medium text-muted-foreground">
            {he.cv.review.dismissedTitle} ({dismissed.length})
          </summary>
          <div className="mt-3 flex flex-wrap gap-2">
            {dismissed.map((skill) => (
              <button
                key={skill.id}
                type="button"
                onClick={() => toggle(skill.id)}
                className="flex items-center gap-1.5 rounded-full border bg-card px-3 py-1 text-xs hover:bg-accent"
              >
                <span>{skill.name_he}</span>
                <span className="text-muted-foreground">+</span>
              </button>
            ))}
          </div>
        </details>
      )}

      {/* Sticky bottom: meter + actions */}
      <div className="fixed bottom-0 right-0 left-0 z-20 border-t bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/75">
        <div className="mx-auto flex max-w-3xl flex-col gap-3 p-4">
          {totalForMeter > 0 && (
            <div>
              <div className="flex h-2 overflow-hidden rounded-full bg-muted">
                {Object.entries(distribution).map(([cat, count]) => (
                  <div
                    key={cat}
                    className={`${CATEGORY_COLORS[cat] ?? "bg-muted-foreground"} transition-[width] duration-200`}
                    style={{ width: `${(count / totalForMeter) * 100}%` }}
                    aria-label={`${cat}: ${count}`}
                  />
                ))}
              </div>
              <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                {Object.entries(distribution).map(([cat, count]) => (
                  <span key={cat} className="flex items-center gap-1.5">
                    <span className={`inline-block h-2 w-2 rounded-full ${CATEGORY_COLORS[cat]}`} aria-hidden />
                    <span>
                      {he.cv.review.categories[cat as keyof typeof he.cv.review.categories] ?? cat} ·{" "}
                      <span className="font-medium text-foreground">{count}</span>
                    </span>
                  </span>
                ))}
              </div>
            </div>
          )}
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm text-muted-foreground">
              {he.cv.review.counter
                .replace("{selected}", String(confirmed.length))
                .replace("{total}", String(allSkills.length))}
            </span>
            <div className="flex gap-2">
              <Button variant="ghost" onClick={onCancelAction} disabled={saving}>
                {he.cv.review.cancel}
              </Button>
              <Button onClick={() => onSaveAction(confirmed.map((s) => s.id))} disabled={saving || saveDisabled || confirmed.length === 0}>
                {saving ? he.cv.review.saving : he.cv.review.save}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function SkillCard({
  skill,
  expanded,
  onToggleExpand,
  onDismiss,
}: {
  skill: ReviewSkill;
  expanded: boolean;
  onToggleExpand: () => void;
  onDismiss: () => void;
}) {
  const isHigh = skill.confidence >= 0.8;
  const isMid = skill.confidence >= 0.5 && skill.confidence < 0.8;
  const dotColor = isHigh
    ? "bg-emerald-500"
    : isMid
      ? "bg-amber-500"
      : "bg-muted-foreground/50";

  return (
    <div className="group rounded-xl border bg-card p-4 transition-shadow hover:shadow-sm">
      <button
        type="button"
        onClick={onToggleExpand}
        className="flex w-full items-start justify-between gap-2 text-right"
        aria-expanded={expanded}
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className={`inline-block h-2 w-2 shrink-0 rounded-full ${dotColor}`} aria-hidden />
            <span className="truncate text-base font-semibold">{skill.name_he}</span>
          </div>
          {!skill.isOther && (
            <span className={`mt-1 inline-block text-xs ${CATEGORY_TEXT_COLORS[skill.category] ?? "text-muted-foreground"}`}>
              {he.cv.review.categories[skill.category as keyof typeof he.cv.review.categories] ?? skill.category}
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onDismiss();
          }}
          aria-label={he.cv.review.dismiss}
          className="text-muted-foreground transition-opacity hover:text-destructive group-hover:opacity-100 sm:opacity-0"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-5 w-5">
            <path d="M6 18L18 6M6 6l12 12" strokeLinecap="round" />
          </svg>
        </button>
      </button>
      {expanded && skill.evidence && (
        <div className="mt-3 rounded-md bg-muted/50 p-2.5 text-xs leading-relaxed">
          <span className="font-medium text-muted-foreground">{he.cv.review.evidenceLabel}</span>{" "}
          <span dir="auto">{skill.evidence}</span>
        </div>
      )}
    </div>
  );
}
