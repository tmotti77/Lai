export type Archetype =
  | "builder"
  | "connector"
  | "analyst"
  | "leader"
  | "creator"
  | "generalist";

type CategoryCount = Map<string, number>;

const DOMINANCE_THRESHOLD = 0.45;

const CATEGORY_TO_ARCHETYPE: Record<string, Archetype> = {
  technical: "builder",
  social: "connector",
  analytical: "analyst",
  managerial: "leader",
  creative: "creator",
};

export function inferArchetype(skillCategories: string[]): Archetype {
  if (skillCategories.length === 0) return "generalist";

  const counts: CategoryCount = new Map();
  for (const c of skillCategories) {
    counts.set(c, (counts.get(c) ?? 0) + 1);
  }

  const total = skillCategories.length;
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  const [topCategory, topCount] = sorted[0];

  if (topCount / total >= DOMINANCE_THRESHOLD) {
    return CATEGORY_TO_ARCHETYPE[topCategory] ?? "generalist";
  }

  return "generalist";
}

export function categoryDistribution(skillCategories: string[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const c of skillCategories) counts[c] = (counts[c] ?? 0) + 1;
  return counts;
}
