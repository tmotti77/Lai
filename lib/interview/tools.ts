import "server-only";
import { tool, generateObject } from "ai";
import { z } from "zod";
import { anthropic, MODEL_ID } from "@/lib/ai/client";
import { completeInterviewSession } from "@/lib/db/interview";

export const WrapUpSchema = z.object({
  summary_he: z.string().min(20).describe("2-4 sentences of overall feedback in Hebrew"),
  strengths_he: z.array(z.string()).min(1).max(4),
  improvements_he: z.array(z.string()).min(1).max(4),
  next_practice_focus_he: z.string().min(10).describe("ONE concrete actionable thing to practice next. One sentence."),
  per_question: z
    .array(z.object({ question_number: z.number().int().min(1), note_he: z.string() }))
    .max(10),
});

export type WrapUpInput = z.infer<typeof WrapUpSchema>;

export function makeWrapUpTool(sessionId: string, currentQuestionCount: number) {
  return tool({
    description:
      "Call this when the interview is complete (after max_questions, or earlier if the interview reached a natural end ≥ question 5). Provide structured Hebrew feedback. This is the ONLY way to end the interview.",
    inputSchema: WrapUpSchema,
    execute: async (input) => {
      if (currentQuestionCount < 5) {
        return {
          wrapped: false,
          error: "too_early" as const,
          retry_message: "המשך בראיון. אל תקרא ל-wrap_up לפני שאלה 5.",
        };
      }
      await completeInterviewSession(sessionId, input);
      return { wrapped: true as const };
    },
  });
}

/**
 * Repair call: when the model fails to call wrap_up despite Mode B prompting,
 * run a one-shot generateObject against the full transcript to extract feedback.
 * Returns the wrap-up payload or null on failure.
 */
export async function runWrapRepairCall(
  transcript: Array<{ role: "user" | "assistant" | "system"; content: string }>,
  targetRoleHe: string,
): Promise<WrapUpInput | null> {
  try {
    const result = await generateObject({
      model: anthropic(MODEL_ID),
      schema: WrapUpSchema,
      system: `אתה מסכם ראיון עבודה שהסתיים. עבור על התמליל וייצר אובייקט wrap_up מובנה בעברית. תפקיד היעד: ${targetRoleHe}. אל תוסיף שאלות חדשות — רק סכם.`,
      messages: transcript.map((m) => ({
        role: m.role === "system" ? "user" : m.role,
        content: m.content,
      })),
    });
    return result.object;
  } catch (err) {
    console.error("[interview] wrap repair call failed", err);
    return null;
  }
}
