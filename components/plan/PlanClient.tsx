"use client";
import { useEffect, useState } from "react";
import { he } from "@/lib/i18n/he";
import { Button } from "@/components/ui/button";
import { WeekSection } from "./WeekSection";
import { PlanEmptyState } from "./PlanEmptyState";
import { toast } from "sonner";
import type { Plan } from "@/lib/plan/types";

export function PlanClient() {
  const [plan, setPlan] = useState<Plan | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);

  const fetchPlan = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/plan");
      if (res.ok) {
        const json = await res.json();
        setPlan(json);
      }
    } finally {
      setLoading(false);
    }
  };

  const generate = async (confirm = true) => {
    if (plan && confirm && !window.confirm(he.plan.regenerateConfirm)) return;
    setGenerating(true);
    try {
      const res = await fetch("/api/plan/generate", { method: "POST" });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        toast.error(json.error === "no_recommendation" ? he.plan.error.noRecommendation : he.plan.error.generic);
        setGenerating(false);
        return;
      }
      const json = await res.json();
      setPlan(json);
    } catch {
      toast.error(he.plan.error.generic);
    }
    setGenerating(false);
  };

  const toggleTask = async (taskId: string, done: boolean): Promise<void> => {
    const res = await fetch(`/api/plan/tasks/${taskId}/toggle`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ done }),
    });
    if (!res.ok) throw new Error("toggle failed");
    if (plan) {
      setPlan({
        ...plan,
        tasks: plan.tasks.map((t) => (t.id === taskId ? { ...t, done } : t)),
      });
    }
  };

  useEffect(() => { fetchPlan(); }, []);

  if (loading) return <div className="py-16 text-center text-muted-foreground">…</div>;

  if (!plan) {
    return (
      <div className="space-y-6">
        <div className="rounded-xl border bg-card p-6 text-center">
          <p className="mb-4 text-base text-muted-foreground">{he.plan.subtitle}</p>
          <Button size="lg" onClick={() => generate(false)} disabled={generating}>
            {generating ? he.plan.generating : he.plan.generate}
          </Button>
        </div>
      </div>
    );
  }

  // Group tasks into weeks of 7 (days 1-7, 8-14, 15-21, 22-28, 29-30)
  const weeks: { number: number; tasks: typeof plan.tasks }[] = [
    { number: 1, tasks: plan.tasks.filter((t) => t.day >= 1 && t.day <= 7) },
    { number: 2, tasks: plan.tasks.filter((t) => t.day >= 8 && t.day <= 14) },
    { number: 3, tasks: plan.tasks.filter((t) => t.day >= 15 && t.day <= 21) },
    { number: 4, tasks: plan.tasks.filter((t) => t.day >= 22 && t.day <= 28) },
    { number: 5, tasks: plan.tasks.filter((t) => t.day >= 29 && t.day <= 30) },
  ];

  const archetypeTitle = he.plan.archetypeTitles[plan.archetype];

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 rounded-xl border bg-card p-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="text-xs uppercase tracking-wide text-muted-foreground">{archetypeTitle}</div>
        </div>
        <Button variant="outline" size="sm" onClick={() => generate(true)} disabled={generating}>
          {generating ? he.plan.generating : he.plan.regenerate}
        </Button>
      </div>
      {weeks.map((w) => (
        <WeekSection key={w.number} weekNumber={w.number} tasks={w.tasks} onToggle={toggleTask} />
      ))}
    </div>
  );
}
