import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ModelMessage } from "ai";

// We mock the AI SDK + safety + Anthropic client at the module boundary.
vi.mock("ai", async () => {
  const actual = await vi.importActual<typeof import("ai")>("ai");
  return {
    ...actual,
    streamText: vi.fn(),
  };
});
vi.mock("@/lib/ai/safety", () => ({
  checkUserMessage: vi.fn(),
}));
vi.mock("@/lib/ai/client", () => ({
  anthropic: vi.fn(() => "mock-model"),
  MODEL_ID: "claude-test",
  extractAnthropicCacheUsage: vi.fn(() => ({ cacheReadInputTokens: 0, cacheCreationInputTokens: 0 })),
}));

import { streamText } from "ai";
import { checkUserMessage } from "@/lib/ai/safety";
import { he } from "@/lib/i18n/he";
import { streamLlmTurn } from "@/lib/ai/engine";

const baseInput = () => ({
  userText: "שלום",
  systemMessage: { role: "system" as const, content: "you are a test" },
  history: [] as ModelMessage[],
  contextLabel: "test",
  contextId: "ctx-1",
  onUserPersist: vi.fn(async () => {}),
  onAssistantFinish: vi.fn(async () => {}),
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe("streamLlmTurn", () => {
  it("short-circuits with a safety-flagged SSE stream when checkUserMessage blocks", async () => {
    (checkUserMessage as ReturnType<typeof vi.fn>).mockResolvedValue({
      allow: false,
      flag: "distress",
      reason: "regex-hit",
    });
    const input = baseInput();
    const response = await streamLlmTurn(input);

    expect(response.headers.get("x-safety-flag")).toBe("distress");
    expect(response.headers.get("Content-Type")).toBe("text/event-stream");
    expect(input.onUserPersist).toHaveBeenCalledWith("שלום", "distress");
    expect(input.onAssistantFinish).toHaveBeenCalledWith(
      expect.objectContaining({ text: he.safety.distressFallback, safetyFlag: "distress" }),
    );
    expect(streamText).not.toHaveBeenCalled();
  });

  it("calls streamText on the safe path and wires onFinish to onAssistantFinish", async () => {
    (checkUserMessage as ReturnType<typeof vi.fn>).mockResolvedValue({ allow: true });

    let capturedOnFinish: ((args: unknown) => Promise<void>) | undefined;
    (streamText as ReturnType<typeof vi.fn>).mockImplementation((opts: Record<string, unknown>) => {
      capturedOnFinish = opts.onFinish as typeof capturedOnFinish;
      return {
        toUIMessageStreamResponse: (init: ResponseInit) =>
          new Response("ok", { ...init, headers: { ...init.headers, "x-stream": "yes" } }),
      };
    });

    const input = baseInput();
    const response = await streamLlmTurn(input);

    expect(streamText).toHaveBeenCalledOnce();
    expect(input.onUserPersist).toHaveBeenCalledWith("שלום", undefined);
    expect(response.headers.get("x-stream")).toBe("yes");

    // Simulate streamText completing.
    await capturedOnFinish!({
      text: "תשובה",
      usage: { inputTokens: 100, outputTokens: 50 },
      providerMetadata: {},
    });
    expect(input.onAssistantFinish).toHaveBeenCalledWith(
      expect.objectContaining({ text: "תשובה" }),
    );
  });

  it("skips safety pre-check when skipSafetyCheck is true (sentinel turns)", async () => {
    (checkUserMessage as ReturnType<typeof vi.fn>).mockResolvedValue({ allow: false, flag: "distress" });
    (streamText as ReturnType<typeof vi.fn>).mockReturnValue({
      toUIMessageStreamResponse: () => new Response("ok"),
    });

    await streamLlmTurn({ ...baseInput(), skipSafetyCheck: true });

    expect(checkUserMessage).not.toHaveBeenCalled();
    expect(streamText).toHaveBeenCalledOnce();
  });
});
