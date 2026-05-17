import {
  streamText,
  stepCountIs,
  type ModelMessage,
  type SystemModelMessage,
  type ToolSet,
  type StopCondition,
} from "ai";
import * as Sentry from "@sentry/nextjs";
import { anthropic, MODEL_ID, extractAnthropicCacheUsage } from "@/lib/ai/client";
import { checkUserMessage } from "@/lib/ai/safety";
import { he } from "@/lib/i18n/he";

export interface FinishArgs {
  text: string;
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  safetyFlag?: string;
}

export interface StreamLlmTurnInput {
  userText: string;
  systemMessage: SystemModelMessage | string;
  history: ModelMessage[];
  tools?: ToolSet;
  stopWhen?: StopCondition<ToolSet>;
  skipSafetyCheck?: boolean;
  contextLabel: string;
  contextId: string;
  onUserPersist: (text: string, safetyFlag?: string) => Promise<void>;
  onAssistantFinish: (args: FinishArgs) => Promise<void>;
  onError?: (error: unknown) => Promise<void>;
  responseHeaders?: Record<string, string>;
}

const SSE_HEADERS = {
  "Content-Type": "text/event-stream",
  "Cache-Control": "no-cache",
  Connection: "keep-alive",
};

function buildSafetyShortCircuitResponse(
  text: string,
  headers: Record<string, string>,
): Response {
  const stream = new ReadableStream({
    start(controller) {
      const enc = new TextEncoder();
      controller.enqueue(enc.encode(`data: {"type":"start"}\n\n`));
      controller.enqueue(enc.encode(`data: {"type":"start-step"}\n\n`));
      controller.enqueue(enc.encode(`data: {"type":"text-start","id":"0"}\n\n`));
      controller.enqueue(
        enc.encode(
          `data: ${JSON.stringify({ type: "text-delta", id: "0", delta: text })}\n\n`,
        ),
      );
      controller.enqueue(enc.encode(`data: {"type":"text-end","id":"0"}\n\n`));
      controller.enqueue(enc.encode(`data: {"type":"finish-step"}\n\n`));
      controller.enqueue(enc.encode(`data: {"type":"finish"}\n\n`));
      controller.enqueue(enc.encode(`data: [DONE]\n\n`));
      controller.close();
    },
  });
  return new Response(stream, { headers: { ...SSE_HEADERS, ...headers } });
}

export async function streamLlmTurn(input: StreamLlmTurnInput): Promise<Response> {
  const {
    userText,
    systemMessage,
    history,
    tools,
    stopWhen,
    skipSafetyCheck,
    contextLabel,
    contextId,
    onUserPersist,
    onAssistantFinish,
    onError,
    responseHeaders = {},
  } = input;

  // === Safety pre-check ===
  if (userText && !skipSafetyCheck) {
    const safety = await checkUserMessage(userText);
    if (!safety.allow) {
      await onUserPersist(userText, safety.flag);
      await onAssistantFinish({
        text: he.safety.distressFallback,
        safetyFlag: safety.flag,
      });
      console.warn(
        `[${contextLabel}] safety short-circuit id=${contextId} flag=${safety.flag} reason=${safety.reason}`,
      );
      return buildSafetyShortCircuitResponse(he.safety.distressFallback, {
        ...responseHeaders,
        "x-safety-flag": safety.flag,
      });
    }
  }

  // Safe (or sentinel) path — persist the user msg if any.
  // Note: skipSafetyCheck does NOT suppress persistence; only empty userText does.
  if (userText) {
    await onUserPersist(userText, undefined);
  }

  const result = streamText({
    model: anthropic(MODEL_ID),
    system: systemMessage,
    messages: history,
    ...(tools ? { tools } : {}),
    ...(stopWhen ? { stopWhen } : { stopWhen: stepCountIs(2) }),
    onFinish: async ({ text, usage, providerMetadata }) => {
      const cache = extractAnthropicCacheUsage(
        usage as Parameters<typeof extractAnthropicCacheUsage>[0],
        providerMetadata as Parameters<typeof extractAnthropicCacheUsage>[1],
      );
      console.log(
        `[${contextLabel}] turn finished id=${contextId} in=${usage?.inputTokens ?? 0} out=${usage?.outputTokens ?? 0} cacheRead=${cache.cacheReadInputTokens ?? 0} cacheWrite=${cache.cacheCreationInputTokens ?? 0}`,
      );
      await onAssistantFinish({
        text,
        inputTokens: usage?.inputTokens,
        outputTokens: usage?.outputTokens,
        cacheReadTokens: cache.cacheReadInputTokens,
        cacheWriteTokens: cache.cacheCreationInputTokens,
      }).catch((finishErr) =>
        console.error(
          `[${contextLabel}] onAssistantFinish threw id=${contextId}`,
          finishErr,
        ),
      );
    },
    onError: async ({ error }) => {
      const message = error instanceof Error ? error.message : String(error);
      console.error(
        `[${contextLabel}] streamText error id=${contextId} error=${message}`,
      );
      Sentry.captureException(error, {
        tags: { context: contextLabel },
        extra: { contextId },
      });
      if (onError) {
        await onError(error).catch((secondary) =>
          console.error(
            `[${contextLabel}] onError callback threw id=${contextId}`,
            secondary,
          ),
        );
      }
    },
  });

  return result.toUIMessageStreamResponse({ headers: responseHeaders });
}
