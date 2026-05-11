"use client";
import { useState } from "react";
import { he } from "@/lib/i18n/he";
import type { PlanTask } from "@/lib/plan/types";

export function PlanTaskRow({ task, onToggle }: { task: PlanTask; onToggle: (done: boolean) => Promise<void> }) {
  const [done, setDone] = useState(task.done);
  const [pending, setPending] = useState(false);
  const categoryLabel = he.plan.categoryLabels[task.category];
  const minutesLabel = he.plan.minutesLabel.replace("{n}", String(task.estimated_minutes));
  const dayLabel = he.plan.dayLabel.replace("{n}", String(task.day));

  const handleToggle = async () => {
    const next = !done;
    setDone(next);
    setPending(true);
    try {
      await onToggle(next);
    } catch {
      setDone(!next); // rollback on error
    } finally {
      setPending(false);
    }
  };

  return (
    <li className={`flex items-start gap-3 rounded-md border p-3 transition-colors ${done ? "bg-muted/50 text-muted-foreground" : "bg-card"}`}>
      <button
        type="button"
        role="checkbox"
        aria-checked={done}
        aria-label={done ? he.plan.completed : task.title_he}
        onClick={handleToggle}
        disabled={pending}
        className={`mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded border-2 transition-colors ${
          done ? "border-primary bg-primary text-primary-foreground" : "border-input hover:border-primary"
        }`}
      >
        {done && <span aria-hidden>✓</span>}
      </button>
      <div className="flex-1 space-y-1">
        <div className="flex items-baseline justify-between gap-2 text-xs text-muted-foreground">
          <span>{dayLabel}</span>
          <span>{categoryLabel} · {minutesLabel}</span>
        </div>
        <div className={`text-base font-medium ${done ? "line-through" : ""}`} dir="auto">{task.title_he}</div>
        <p className="text-sm" dir="auto">{task.description_he}</p>
      </div>
    </li>
  );
}
