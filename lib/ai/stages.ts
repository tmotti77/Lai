export const STAGES = [
  "onboarding",
  "interests",
  "skills",
  "values",
  "constraints",
  "wrap",
  "complete",
] as const;

export type Stage = (typeof STAGES)[number];

export function isValidStage(value: unknown): value is Stage {
  return typeof value === "string" && (STAGES as readonly string[]).includes(value);
}

export function getNextStage(stage: Stage): Stage | null {
  const idx = STAGES.indexOf(stage);
  if (idx < 0 || idx >= STAGES.length - 1) return null;
  return STAGES[idx + 1];
}

/**
 * Stages where end-of-stage profile extraction should run.
 * onboarding → no extraction (just collecting basics)
 * complete → no extraction (already wrapped)
 */
export const EXTRACTION_STAGES: ReadonlySet<Stage> = new Set([
  "interests",
  "skills",
  "values",
  "constraints",
  "wrap",
]);
