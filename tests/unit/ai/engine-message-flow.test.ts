import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ModelMessage } from "ai";

vi.mock("ai", async () => {
  const actual = await vi.importActual<typeof import("ai")>("ai");
  return { ...actual, streamText: vi.fn() };
});
vi.mock("@/lib/ai/safety", () => ({ checkUserMessage: vi.fn().mockResolvedValue({ allow: true }) }));
vi.mock("@/lib/ai/client", () => ({
  anthropic: vi.fn(() => "mock-model"),
  MODEL_ID: "claude-test",
  extractAnthropicCacheUsage: vi.fn(() => ({})),
}));

import { streamText } from "ai";
import { streamLlmTurn } from "@/lib/ai/engine";

beforeEach(() => vi.clearAllMocks());

describe("streamLlmTurn — message flow", () => {
  it("uses the exact history the caller provides (engine does not append userText itself)", async () => {
    let captured: { messages?: ModelMessage[] } = {};
    (streamText as ReturnType<typeof vi.fn>).mockImplementation((opts: Record<string, unknown>) => {
      captured = opts as { messages?: ModelMessage[] };
      return { toUIMessageStreamResponse: () => new Response("ok") };
    });

    const historyWithCurrentTurn: ModelMessage[] = [
      { role: "user", content: "earlier user msg" },
      { role: "assistant", content: "earlier assistant reply" },
      { role: "user", content: "CURRENT TURN" }, // ← caller appended
    ];

    await streamLlmTurn({
      userText: "CURRENT TURN",
      systemMessage: { role: "system", content: "test" },
      history: historyWithCurrentTurn,
      contextLabel: "test",
      contextId: "ctx-1",
      onUserPersist: vi.fn(),
      onAssistantFinish: vi.fn(),
    });

    expect(captured.messages).toBeDefined();
    const last = captured.messages![captured.messages!.length - 1];
    expect(last.role).toBe("user");
    expect(last.content).toBe("CURRENT TURN");
  });
});

describe("chat route — message flow integration shape", () => {
  it("when caller appends current turn pattern, streamText sees the right tail", async () => {
    let captured: { messages?: ModelMessage[] } = {};
    (streamText as ReturnType<typeof vi.fn>).mockImplementation((opts: Record<string, unknown>) => {
      captured = opts as { messages?: ModelMessage[] };
      return { toUIMessageStreamResponse: () => new Response("ok") };
    });

    // Simulate the chat-route construction:
    const priorHistory: ModelMessage[] = [
      { role: "user", content: "msg 1" },
      { role: "assistant", content: "reply 1" },
    ];
    const userText = "msg 2";
    const messagesForLlm: ModelMessage[] = userText
      ? [...priorHistory, { role: "user", content: userText }]
      : priorHistory;

    await streamLlmTurn({
      userText,
      systemMessage: { role: "system", content: "test" },
      history: messagesForLlm,
      contextLabel: "chat",
      contextId: "conv-1",
      onUserPersist: vi.fn(),
      onAssistantFinish: vi.fn(),
    });

    expect(captured.messages).toHaveLength(3);
    expect(captured.messages![2]).toEqual({ role: "user", content: "msg 2" });
  });
});
