"use client";
import { he } from "@/lib/i18n/he";
import { PlanTaskRow } from "./PlanTaskRow";
import type { PlanTask } from "@/lib/plan/types";

export function WeekSection({
  weekNumber,
  tasks,
  onToggle,
}: {
  weekNumber: number;
  tasks: PlanTask[];
  onToggle: (taskId: string, done: boolean) => Promise<void>;
}) {
  const heading = he.plan.weekHeading.replace("{n}", String(weekNumber));
  const completed = tasks.filter((t) => t.done).length;
  return (
    <section className="space-y-3">
      <header className="flex items-baseline justify-between border-b pb-2">
        <h2 className="text-lg font-semibold">{heading}</h2>
        <span className="text-sm text-muted-foreground">{completed} / {tasks.length}</span>
      </header>
      <ul className="space-y-2">
        {tasks.map((t) => (
          <PlanTaskRow key={t.id} task={t} onToggle={(done) => onToggle(t.id, done)} />
        ))}
      </ul>
    </section>
  );
}
