import "server-only";
import { streamText, Output, type ModelMessage } from "ai";
import { anthropic, MODEL_ID } from "@/lib/ai/client";
import { CvExtractionSchema } from "./schema";

export { CvExtractionSchema };
export type { CvExtractionOutput } from "./schema";

/**
 * Stream a CV extraction. The system prompt is large (~5K tokens with
 * taxonomy) and cached via Anthropic ephemeral cache control — first
 * extraction writes the cache, subsequent ones read it. Per-message
 * cacheControl on the system role (not top-level providerOptions) — top-level
 * would mark the user message (which changes every call) as the cache
 * breakpoint, making the cache write-only.
 */
export function streamCvExtraction(
  systemPrompt: string,
  cvText: string,
) {
  const messages: ModelMessage[] = [
    {
      role: "system",
      content: systemPrompt,
      providerOptions: {
        anthropic: { cacheControl: { type: "ephemeral" } },
      },
    },
    { role: "user", content: cvText },
  ];

  return streamText({
    model: anthropic(MODEL_ID),
    output: Output.object({ schema: CvExtractionSchema }),
    messages,
  });
}
