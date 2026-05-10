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
      "Call this when you judge the current stage of the assessment is complete and the user is ready to move to the next stage. The tool call is invisible to the user — do not also write the stage name in the visible text.",
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
