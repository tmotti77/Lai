import "server-only";
import { generateText, Output } from "ai";
import { z } from "zod";
import { anthropic, MODEL_ID } from "@/lib/ai/client";
import { loadMessages } from "@/lib/db/queries";
import { mergeProfileExtraction } from "@/lib/db/profile";
import type { Stage } from "@/lib/ai/stages";
import {
  EXTRACTION_SYSTEM_PROMPT,
  buildExtractionUserPrompt,
} from "@/lib/ai/prompts/extraction";

// Loose-by-design zod schemas. Extraction is best-effort; the LLM may return
// only the slice relevant to the current stage and leave others undefined.

const InterestSchema = z.object({
  label: z.string(),
  label_he: z.string(),
  evidence: z.string(),
  confidence: z.enum(["low", "medium", "high"]),
});

const SkillSchema = z.object({
  label: z.string(),
  label_he: z.string(),
  evidence: z.string(),
  source: z.enum(["army", "work", "studies", "hobby", "self-taught", "other"]),
});

// Value vocabulary keys — must match lib/matching/types.ts values_fit strings
// and the formal assessment items in lib/assessment/values/items.ts.
const VALUE_KEYS = [
  "money",
  "stability",
  "meaning",
  "impact",
  "freedom",
  "prestige",
  "learning",
  "belonging",
  "schedule",
  "creation",
  "balance",
] as const;

// Chat-extracted values are stored as a flat string[] in career_profile.data.values.
// buildMatchingProfile (lib/matching/profile.ts) slices [0..3] → topThree, [3..5] → alsoPicked.
// Extraction emits primary values first, then secondary, so the slice works correctly.
// Using z.enum here ensures the LLM emits canonical keys the matcher can look up.
const ValueKeySchema = z.enum(VALUE_KEYS);

// Constraints must mirror MatchingProfile["constraints"] in lib/matching/types.ts exactly,
// so that the chat path and formal-assessment path both produce the same shape.
const ConstraintsSchema = z.object({
  location_he: z.string().optional(),
  remote_ok: z.boolean().optional(),
  time_per_week_hours: z.number().min(0).max(60).optional(),
  training_budget_nis: z.number().min(0).max(200_000).optional(),
  // "none"|"basic"|"intermediate"|"advanced"|"fluent" — NEVER "native"
  english_level: z
    .enum(["none", "basic", "intermediate", "advanced", "fluent"])
    .optional(),
  // Integer 1–10: 1 = most risk-averse, 10 = most risk-tolerant
  risk_tolerance: z.number().int().min(1).max(10).optional(),
  needs_immediate_income: z.boolean().optional(),
  months_until_income_required: z.number().int().min(0).max(36).optional(),
});

const ProfileSchema = z.object({
  interests: z.array(InterestSchema).optional(),
  skills: z.array(SkillSchema).optional(),
  // Flat string[] of canonical value keys, primary values first.
  // Stored as career_profile.data.values and consumed by buildMatchingProfile.
  values: z.array(ValueKeySchema).max(11).optional(),
  constraints: ConstraintsSchema.optional(),
  summary_he: z.string().optional(),
});

export type ExtractedProfile = z.infer<typeof ProfileSchema>;

export async function runExtraction(opts: {
  userId: string;
  conversationId: string;
  stage: Stage;
}): Promise<ExtractedProfile | null> {
  const messages = await loadMessages(opts.conversationId);
  const conversationText = messages
    .map((m) => `${m.role}: ${m.content}`)
    .join("\n");

  if (conversationText.length < 50) {
    // Not enough conversation to extract from yet.
    return null;
  }

  const result = await generateText({
    model: anthropic(MODEL_ID),
    system: EXTRACTION_SYSTEM_PROMPT,
    prompt: buildExtractionUserPrompt(opts.stage, conversationText),
    output: Output.object({ schema: ProfileSchema }),
  });
  const object = result.output;

  await mergeProfileExtraction({
    userId: opts.userId,
    conversationId: opts.conversationId,
    stage: opts.stage,
    data: object as Record<string, unknown>,
  });

  return object;
}
