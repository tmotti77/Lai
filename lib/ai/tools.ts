import "server-only";
import { tool } from "ai";
import { z } from "zod";
import { STAGES } from "@/lib/ai/stages";

const stageEnum = z.enum(STAGES);

/**
 * Tool exposed to Claude so it can advance the conversation stage when it judges
 * the current stage complete. The tool's `execute` handler is provided by the
 * chat route per-request because it needs the conversation_id and user_id closures.
 */
export function makeSetStageTool(args: {
  onAdvance: (
    nextStage: z.infer<typeof stageEnum>,
    reason: string,
  ) => Promise<void>;
}) {
  return tool({
    description:
      "REQUIRED stage advancement mechanism. You MUST call this tool when the per-stage transition criteria are met (each stage prompt defines its own criteria). Do not rely on the user to ask you to advance — that's your job. The tool call is invisible to the user — do not also write the stage name in the visible text. Failing to call this tool when criteria are met causes the assessment to stall in the current stage indefinitely.",
    inputSchema: z.object({
      next_stage: stageEnum.describe(
        "The next stage to move into. Must be one of the canonical stages.",
      ),
      reason: z
        .string()
        .min(5)
        .max(280)
        .describe(
          "Brief explanation (Hebrew or English) of why the current stage is complete. For audit/debugging.",
        ),
    }),
    execute: async ({ next_stage, reason }) => {
      await args.onAdvance(next_stage, reason);
      return `Stage advanced to ${next_stage}.`;
    },
  });
}
