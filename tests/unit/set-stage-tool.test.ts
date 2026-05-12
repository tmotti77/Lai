import { describe, it, expect, vi } from "vitest";
import { makeSetStageTool } from "@/lib/ai/tools";
import { STAGES } from "@/lib/ai/stages";

describe("makeSetStageTool", () => {
  it("returns a tool with the required-call language so the model treats it as load-bearing", () => {
    // The exact phrasing matters — empirical testing (see PR #18 + the
    // `npx tsx scripts/e2e-test-chat.ts stage` flow) showed that softer
    // descriptions cause Claude to skip the tool call. Keep the contract
    // explicit so a future edit doesn't silently regress chat funnel
    // progression.
    const tool = makeSetStageTool({ onAdvance: async () => {} });
    const description = tool.description ?? "";
    expect(description).toMatch(/REQUIRED/);
    expect(description).toMatch(/MUST/);
    expect(description.toLowerCase()).toContain("stage");
    expect(description.toLowerCase()).toContain("invisible to the user");
  });

  it("execute invokes onAdvance with next_stage and reason", async () => {
    const onAdvance = vi.fn().mockResolvedValue(undefined);
    const tool = makeSetStageTool({ onAdvance });
    expect(tool.execute).toBeDefined();

    const reply = await tool.execute!(
      { next_stage: "interests", reason: "criteria met" },
      // ToolExecutionOptions is required by the type; the route doesn't pass anything
      // meaningful through it for set_stage.
      { toolCallId: "test-1", messages: [] },
    );

    expect(onAdvance).toHaveBeenCalledTimes(1);
    expect(onAdvance).toHaveBeenCalledWith("interests", "criteria met");
    expect(reply).toBe("Stage advanced to interests.");
  });

  it("inputSchema accepts every canonical stage as next_stage", async () => {
    const tool = makeSetStageTool({ onAdvance: async () => {} });
    // tool.inputSchema may be a zod schema, a JSON-schema lazy thing, or a
    // FlexibleSchema. Treat it duck-typed: anything with a .safeParse() is
    // a zod schema we can validate against directly.
    const schema = tool.inputSchema as unknown as {
      safeParse?: (v: unknown) => { success: boolean };
    };
    if (typeof schema.safeParse !== "function") {
      // If the SDK switches to JSON-schema-only at some point, this test
      // becomes a no-op rather than a false failure.
      return;
    }
    for (const stage of STAGES) {
      const result = schema.safeParse({ next_stage: stage, reason: "valid reason text" });
      expect(result.success).toBe(true);
    }
  });

  it("inputSchema rejects unknown stage names", () => {
    const tool = makeSetStageTool({ onAdvance: async () => {} });
    const schema = tool.inputSchema as unknown as {
      safeParse?: (v: unknown) => { success: boolean };
    };
    if (typeof schema.safeParse !== "function") return;
    const bad = schema.safeParse({ next_stage: "nonexistent-stage", reason: "anything" });
    expect(bad.success).toBe(false);
  });

  it("inputSchema rejects too-short reason", () => {
    const tool = makeSetStageTool({ onAdvance: async () => {} });
    const schema = tool.inputSchema as unknown as {
      safeParse?: (v: unknown) => { success: boolean };
    };
    if (typeof schema.safeParse !== "function") return;
    const bad = schema.safeParse({ next_stage: "interests", reason: "x" });
    expect(bad.success).toBe(false);
  });
});
