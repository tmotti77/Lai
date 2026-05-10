import "server-only";
import { generateObject } from "ai";
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

const ValueSchema = z.object({
  key: z.enum([
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
  ]),
  label_he: z.string(),
  evidence: z.string(),
  weight: z.enum(["primary", "secondary"]),
});

const ConstraintsSchema = z.object({
  budget_he: z.string().optional(),
  time_per_week_hours: z.number().optional(),
  location_he: z.string().optional(),
  income_urgency_he: z.string().optional(),
  risk_tolerance_1_10: z.number().min(1).max(10).optional(),
  english_level: z
    .enum(["none", "basic", "intermediate", "advanced", "native"])
    .optional(),
  notes_he: z.string().optional(),
});

const ProfileSchema = z.object({
  interests: z.array(InterestSchema).optional(),
  skills: z.array(SkillSchema).optional(),
  values: z.array(ValueSchema).optional(),
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

  const { object } = await generateObject({
    model: anthropic(MODEL_ID),
    system: EXTRACTION_SYSTEM_PROMPT,
    prompt: buildExtractionUserPrompt(opts.stage, conversationText),
    schema: ProfileSchema,
    schemaName: "extract_profile",
    schemaDescription: "Extracted profile data for this assessment stage.",
  });

  await mergeProfileExtraction({
    userId: opts.userId,
    conversationId: opts.conversationId,
    stage: opts.stage,
    data: object as Record<string, unknown>,
  });

  return object;
}
