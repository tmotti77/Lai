export const ARCHETYPES = ["apply", "taste_test", "research"] as const;
export type Archetype = (typeof ARCHETYPES)[number];

export const TASK_CATEGORIES = ["action", "research", "network", "reflection"] as const;
export type TaskCategory = (typeof TASK_CATEGORIES)[number];

export type PlanTask = {
  id: string;
  day: number;             // 1..30
  title_he: string;
  description_he: string;
  category: TaskCategory;
  estimated_minutes: number;
  done: boolean;
  done_at: string | null;
};

export type Plan = {
  id: string;
  recommendation_id: string;
  archetype: Archetype;
  generated_at: string;
  tasks: PlanTask[];
};
