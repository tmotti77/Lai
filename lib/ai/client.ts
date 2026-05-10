import "server-only";
import { createAnthropic } from "@ai-sdk/anthropic";
import type { ModelMessage } from "ai";
import { serverEnv } from "@/lib/env";
import { assembleSystemPrompt, SYSTEM_PROMPT_VERSION } from "@/lib/ai/prompts/system";
import type { Stage } from "@/lib/ai/stages";

export const MODEL_ID = serverEnv.ANTHROPIC_MODEL;

export const anthropic = createAnthropic({
  apiKey: serverEnv.ANTHROPIC_API_KEY,
});

/**
 * Returns the system message for the given stage, with Anthropic ephemeral
 * cache control applied. The base prompt + per-stage overlay are composed at
 * call time. Cache control is a *provider* concept and only applies to
 * ModelMessages — UIMessage does not carry providerOptions.
 */
export function getCachedSystemMessage(stage: Stage): ModelMessage {
  return {
    role: "system",
    content: assembleSystemPrompt(stage),
    providerOptions: {
      anthropic: { cacheControl: { type: "ephemeral" } },
    },
  };
}

/**
 * Anthropic-specific cache token names exposed via providerMetadata.
 * Verified against AI SDK's @ai-sdk/anthropic provider metadata shape:
 *   - cacheCreationInputTokens: tokens written to cache on this call
 *   - cacheReadInputTokens: tokens read from cache (the savings)
 */
export type AnthropicCacheUsage = {
  cacheCreationInputTokens?: number;
  cacheReadInputTokens?: number;
};

export function extractAnthropicCacheUsage(
  providerMetadata: Record<string, unknown> | undefined,
): AnthropicCacheUsage {
  const meta = providerMetadata?.anthropic as AnthropicCacheUsage | undefined;
  return {
    cacheCreationInputTokens: meta?.cacheCreationInputTokens,
    cacheReadInputTokens: meta?.cacheReadInputTokens,
  };
}

export { SYSTEM_PROMPT_VERSION };
