import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ModelMessage } from "ai";

// Regression test for the production bug:
// Anthropic rejects requests with empty text content blocks. When Claude
// called set_stage with no surrounding prose, the assistant message got
// persisted as content="". Future turns then sent it to Anthropic and
// got "messages: text content blocks must be non-empty" errors.
//
// Two-layer fix:
//  1. onAssistantFinish: skip persist when args.text is empty
//  2. historyAsModelMessages: filter out empty content rows on replay
//
// This test pins both behaviors so they don't regress.

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({
    get: vi.fn(() => undefined),
    set: vi.fn(),
    delete: vi.fn(),
  })),
  headers: vi.fn(() => ({ get: vi.fn(() => null) })),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    auth: { getUser: async () => ({ data: { user: null } }) },
  })),
}));

vi.mock("@/lib/anonymous", () => ({
  getOrCreateAnonymousUserId: vi.fn(async () => "test-user-id"),
  ANON_COOKIE_NAME: "co_anon",
}));

vi.mock("@/lib/consent", () => ({
  requireConsent: vi.fn(async () => {}),
  NoConsentError: class NoConsentError extends Error {},
}));

vi.mock("@/lib/db/queries", () => ({
  getOrCreateConversation: vi.fn(async () => ({
    id: "conv-id",
    user_id: "test-user-id",
    stage: "onboarding",
  })),
  loadMessages: vi.fn(),
  appendMessage: vi.fn(),
}));

vi.mock("@/lib/db/profile", () => ({
  updateConversationStage: vi.fn(),
}));

vi.mock("@/lib/ai/extraction", () => ({
  runExtraction: vi.fn(async () => {}),
}));

vi.mock("@/lib/ai/tools", () => ({
  makeSetStageTool: vi.fn(() => ({ description: "test", inputSchema: {}, execute: vi.fn() })),
}));

vi.mock("@/lib/ai/safety", () => ({
  checkUserMessage: vi.fn().mockResolvedValue({ allow: true, flag: null }),
}));

vi.mock("@/lib/analytics", () => ({
  track: vi.fn(),
}));

// Capture streamText call args. Engine calls streamText then we read messages.
let capturedMessages: ModelMessage[] | undefined;
let onFinishCallback: ((args: { text: string; usage?: Record<string, number>; providerMetadata?: unknown }) => Promise<void>) | undefined;

vi.mock("ai", async () => {
  const actual = await vi.importActual<typeof import("ai")>("ai");
  return {
    ...actual,
    streamText: vi.fn((opts: Record<string, unknown>) => {
      capturedMessages = (opts as { messages?: ModelMessage[] }).messages;
      onFinishCallback = (opts as { onFinish?: typeof onFinishCallback }).onFinish;
      return {
        toUIMessageStreamResponse: () => new Response("ok"),
      };
    }),
  };
});

vi.mock("@/lib/ai/client", () => ({
  anthropic: vi.fn(() => "mock-model"),
  MODEL_ID: "claude-test",
  extractAnthropicCacheUsage: vi.fn(() => ({})),
  getCachedSystemMessage: vi.fn(() => ({ role: "system", content: "test" })),
}));

beforeEach(() => {
  vi.clearAllMocks();
  capturedMessages = undefined;
  onFinishCallback = undefined;
});

function makeChatRequest(body: unknown): Request {
  return new Request("http://localhost/api/chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("chat route: empty-message filter (regression)", () => {
  it("filters out historical empty-content assistant rows before sending to LLM", async () => {
    const { loadMessages } = await import("@/lib/db/queries");
    (loadMessages as ReturnType<typeof vi.fn>).mockResolvedValue([
      { role: "user", content: "first user message" },
      { role: "assistant", content: "first reply" },
      { role: "user", content: "second user message" },
      { role: "assistant", content: "" }, // ← poisoned empty (tool-only turn)
      { role: "user", content: "current turn" },
    ]);

    const { POST } = await import("@/app/api/chat/route");
    const handler = POST as unknown as (req: Request) => Promise<Response>;
    await handler(
      makeChatRequest({
        messages: [{ id: "1", role: "user", parts: [{ type: "text", text: "current turn" }] }],
      }),
    );

    expect(capturedMessages).toBeDefined();
    // The empty assistant message must NOT be in what we send to Anthropic
    expect(capturedMessages!.every((m) => typeof m.content === "string" && m.content.trim().length > 0)).toBe(true);
    // No "assistant" role in the messages with empty content
    expect(capturedMessages!.filter((m) => m.role === "assistant").every((m) => (m.content as string).trim().length > 0)).toBe(true);
    // The single non-empty assistant from history is preserved
    expect(capturedMessages!.filter((m) => m.role === "assistant").map((m) => m.content)).toEqual(["first reply"]);
  });

  it("does NOT persist an empty assistant turn (tool-only response)", async () => {
    const { loadMessages, appendMessage } = await import("@/lib/db/queries");
    (loadMessages as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    const { POST } = await import("@/app/api/chat/route");
    const handler = POST as unknown as (req: Request) => Promise<Response>;
    await handler(
      makeChatRequest({
        messages: [{ id: "1", role: "user", parts: [{ type: "text", text: "hi" }] }],
      }),
    );

    // Simulate Claude completing the turn with empty text (only a tool call was made)
    expect(onFinishCallback).toBeDefined();
    await onFinishCallback!({ text: "", usage: { inputTokens: 100, outputTokens: 2 } });

    // The user message gets persisted via onUserPersist, but assistant with text="" must NOT
    const calls = (appendMessage as ReturnType<typeof vi.fn>).mock.calls;
    const assistantPersists = calls.filter((c) => c[0].role === "assistant");
    expect(assistantPersists.length).toBe(0);
  });

  it("DOES persist a normal (non-empty) assistant turn", async () => {
    const { loadMessages, appendMessage } = await import("@/lib/db/queries");
    (loadMessages as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    const { POST } = await import("@/app/api/chat/route");
    const handler = POST as unknown as (req: Request) => Promise<Response>;
    await handler(
      makeChatRequest({
        messages: [{ id: "1", role: "user", parts: [{ type: "text", text: "hi" }] }],
      }),
    );

    await onFinishCallback!({ text: "שלום! איך אפשר לעזור?", usage: { inputTokens: 100, outputTokens: 25 } });

    const calls = (appendMessage as ReturnType<typeof vi.fn>).mock.calls;
    const assistantPersists = calls.filter((c) => c[0].role === "assistant");
    expect(assistantPersists.length).toBe(1);
    expect(assistantPersists[0][0].content).toBe("שלום! איך אפשר לעזור?");
  });

  it("treats whitespace-only assistant text as empty (no persist)", async () => {
    const { loadMessages, appendMessage } = await import("@/lib/db/queries");
    (loadMessages as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    const { POST } = await import("@/app/api/chat/route");
    const handler = POST as unknown as (req: Request) => Promise<Response>;
    await handler(
      makeChatRequest({
        messages: [{ id: "1", role: "user", parts: [{ type: "text", text: "hi" }] }],
      }),
    );

    await onFinishCallback!({ text: "   \n\t  ", usage: {} });

    const calls = (appendMessage as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls.filter((c) => c[0].role === "assistant").length).toBe(0);
  });
});
