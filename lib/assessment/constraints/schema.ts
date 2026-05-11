import { z } from "zod";

export const CONSTRAINTS_VERSION = 1;

export const ENGLISH_LEVELS = ["none", "basic", "intermediate", "advanced", "fluent"] as const;

export const ConstraintsSchema = z.object({
  location_he: z.string().min(1).max(40),
  remote_ok: z.boolean().optional(),
  time_per_week_hours: z.number().int().min(0).max(60),
  training_budget_nis: z.number().int().min(0).max(200_000),
  english_level: z.enum(ENGLISH_LEVELS).optional(),
  risk_tolerance: z.number().int().min(1).max(10).optional(),
  needs_immediate_income: z.boolean().optional(),
  months_until_income_required: z.number().int().min(0).max(60).optional(),
});

export type ConstraintsSubmission = z.infer<typeof ConstraintsSchema>;
