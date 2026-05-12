import "server-only";
import { createAnthropic } from "@ai-sdk/anthropic";
import type { SystemModelMessage } from "ai";
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
 *
 * Returns SystemModelMessage (not the broader ModelMessage union) so it can
 * be passed directly to streamText's `system:` parameter.
 */
export function getCachedSystemMessage(stage: Stage): SystemModelMessage {
  return {
    role: "system",
    content: assembleSystemPrompt(stage),
    providerOptions: {
      anthropic: { cacheControl: { type: "ephemeral" } },
    },
  };
}

/**
 * Cache token usage from a Claude response.
 *
 * In AI SDK v6:
 * - `cacheCreationInputTokens` lives on Anthropic-specific provider metadata
 *   (`providerMetadata.anthropic.cacheCreationInputTokens`)
 * - Cache **reads** were standardized cross-provider into `usage.cachedInputTokens`
 *   (and the modern path `usage.inputTokenDetails.cacheReadTokens`).
 *   `providerMetadata.anthropic.cacheReadInputTokens` does NOT exist on the type.
 *   We read both modern + deprecated to be safe.
 */
export type AnthropicCacheUsage = {
  cacheCreationInputTokens?: number;
  cacheReadInputTokens?: number;
};

type UsageWithCacheRead = {
  cachedInputTokens?: number;
  inputTokenDetails?: { cacheReadTokens?: number };
};

export function extractAnthropicCacheUsage(
  usage: UsageWithCacheRead | undefined,
  providerMetadata: Record<string, unknown> | undefined,
): AnthropicCacheUsage {
  const anthropicMeta = providerMetadata?.anthropic as
    | { cacheCreationInputTokens?: number | null }
    | undefined;
  return {
    cacheCreationInputTokens: anthropicMeta?.cacheCreationInputTokens ?? undefined,
    cacheReadInputTokens:
      usage?.inputTokenDetails?.cacheReadTokens ?? usage?.cachedInputTokens,
  };
}

export { SYSTEM_PROMPT_VERSION };
