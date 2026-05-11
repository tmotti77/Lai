import "server-only";
import { createServiceClient } from "@/lib/supabase/service";
import type { Plan, PlanTask, Archetype } from "@/lib/plan/types";
import type { ComposedTask } from "@/lib/plan/compose";

export async function createPlan(args: {
  userId: string;
  recommendationId: string;
  archetype: Archetype;
  tasks: ComposedTask[];
}): Promise<Plan> {
  const svc = createServiceClient();

  // Delete any previous plan for this recommendation
  await svc.from("plans").delete().eq("recommendation_id", args.recommendationId);

  const { data: planRow, error: planErr } = await svc
    .from("plans")
    .insert({
      user_id: args.userId,
      recommendation_id: args.recommendationId,
      archetype: args.archetype,
    })
    .select()
    .single();
  if (planErr || !planRow) throw planErr ?? new Error("plan insert failed");

  const taskRows = args.tasks.map((t) => ({
    plan_id: planRow.id,
    day: t.day,
    title_he: t.title_he,
    description_he: t.description_he,
    category: t.category,
    estimated_minutes: t.estimated_minutes,
  }));
  const { data: insertedTasks, error: tasksErr } = await svc
    .from("plan_tasks")
    .insert(taskRows)
    .select();
  if (tasksErr) throw tasksErr;

  return {
    id: planRow.id,
    recommendation_id: planRow.recommendation_id,
    archetype: planRow.archetype as Archetype,
    generated_at: planRow.generated_at,
    tasks: (insertedTasks ?? []).map(rowToTask).sort((a, b) => a.day - b.day),
  };
}

export async function getLatestPlan(userId: string): Promise<Plan | null> {
  const svc = createServiceClient();
  const { data: planRow } = await svc
    .from("plans")
    .select("*")
    .eq("user_id", userId)
    .order("generated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!planRow) return null;

  const { data: taskRows, error } = await svc
    .from("plan_tasks")
    .select("*")
    .eq("plan_id", planRow.id)
    .order("day", { ascending: true });
  if (error) throw error;

  return {
    id: planRow.id,
    recommendation_id: planRow.recommendation_id,
    archetype: planRow.archetype as Archetype,
    generated_at: planRow.generated_at,
    tasks: (taskRows ?? []).map(rowToTask),
  };
}

export async function toggleTask(args: {
  userId: string;
  taskId: string;
  done: boolean;
}): Promise<{ done: boolean; done_at: string | null }> {
  const svc = createServiceClient();
  // Verify ownership via the plan
  const { data: taskRow, error: readErr } = await svc
    .from("plan_tasks")
    .select("plan_id, plans!inner(user_id)")
    .eq("id", args.taskId)
    .single();
  if (readErr) throw readErr;
  const plan = (taskRow as unknown as { plans: { user_id: string } }).plans;
  if (plan.user_id !== args.userId) throw new Error("forbidden");

  const { data, error } = await svc
    .from("plan_tasks")
    .update({ done: args.done, done_at: args.done ? new Date().toISOString() : null })
    .eq("id", args.taskId)
    .select("done, done_at")
    .single();
  if (error) throw error;
  return { done: data.done, done_at: data.done_at };
}

function rowToTask(row: {
  id: string; day: number; title_he: string; description_he: string;
  category: string; estimated_minutes: number; done: boolean; done_at: string | null;
}): PlanTask {
  return {
    id: row.id,
    day: row.day,
    title_he: row.title_he,
    description_he: row.description_he,
    category: row.category as PlanTask["category"],
    estimated_minutes: row.estimated_minutes,
    done: row.done,
    done_at: row.done_at,
  };
}
