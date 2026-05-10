import "server-only";
import { generateObject } from "ai";
import { z } from "zod";
import { anthropic, MODEL_ID } from "@/lib/ai/client";

const ClassificationSchema = z.object({
  category: z
    .enum(["safe", "distress", "crisis"])
    .describe(
      "safe = normal career question. distress = severe emotional pain without explicit ideation. crisis = explicit suicide / self-harm ideation.",
    ),
  reasoning: z.string().min(5).max(200),
});

export type Classification = z.infer<typeof ClassificationSchema>;

const SYSTEM = `You are a safety classifier for a Hebrew career-guidance chat app. You receive a single user message and classify whether it indicates emotional distress requiring handoff to mental-health resources, or it is a normal career question. Output structured JSON only.

Rules:
- "crisis" = the user expresses explicit ideation about suicide, self-harm, or wanting to die.
- "distress" = the user expresses severe emotional pain, hopelessness, or is in a clearly bad mental state, even without explicit ideation.
- "safe" = a normal career question, frustration with work, or general venting that is not severe.

When uncertain between safe and distress, lean toward distress. When uncertain between distress and crisis, lean toward crisis. Better a false positive than a missed signal.`;

export async function classifyMessage(userMessage: string): Promise<Classification> {
  const { object } = await generateObject({
    model: anthropic(MODEL_ID),
    system: SYSTEM,
    prompt: `User message:\n\n${userMessage}\n\nClassify.`,
    schema: ClassificationSchema,
    schemaName: "classify_safety",
  });
  return object;
}
