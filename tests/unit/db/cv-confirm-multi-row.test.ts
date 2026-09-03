import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: vi.fn(),
}));

import { createServiceClient } from "@/lib/supabase/service";

let capturedUpdate: { table?: string; values?: unknown; whereId?: string } = {};

function mockClient(opts: {
  rows: Array<{ id: string; data: unknown; updated_at: string; conversation_id?: string | null }>;
  conversations?: Array<{ id: string }>;
}) {
  return {
    from: (table: string) => {
      if (table === "conversations") {
        return {
          select: () => ({
            eq: () => ({
              order: () => ({
                limit: () =>
                  Promise.resolve({
                    data: opts.conversations ?? null,
                    error: null,
                  }),
              }),
            }),
          }),
        };
      }

      if (table === "career_profile") {
        return {
          select: () => ({
            eq: (col: string, val?: string | null) => ({
              order: () => ({
                limit: () => ({
                  maybeSingle: () =>
                    Promise.resolve({ data: opts.rows[0] ?? null, error: null }),
                }),
              }),
            }),
          }),
          update: (values: unknown) => ({
            eq: (col: string, val: string) => {
              if (col === "id") {
                capturedUpdate = { table, values, whereId: val };
              }
              return Promise.resolve({ error: null });
            },
          }),
        };
      }

      throw new Error(`Unexpected table: ${table}`);
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  capturedUpdate = {};
});

describe("cv confirm: multi-row update scoping", () => {
  it("picks the latest career_profile row and updates by its id", async () => {
    (createServiceClient as ReturnType<typeof vi.fn>).mockReturnValue(
      mockClient({
        rows: [
          { id: "row-LATEST", data: { skills: [] }, updated_at: "2026-05-17T00:00:00Z" },
        ],
      }),
    );

    const { mergeCvSkillsIntoLatestProfile } = await import("@/app/api/cv/confirm/route");
    await mergeCvSkillsIntoLatestProfile("user-1", [
      { id: "python", name_he: "Python", source: "cv" },
    ]);

    expect(capturedUpdate.table).toBe("career_profile");
    expect(capturedUpdate.whereId).toBe("row-LATEST");
    expect((capturedUpdate.values as { data: { skills: unknown[] } }).data.skills).toHaveLength(1);
  });

  it("sets conversation_id on UPDATE when a conversation exists", async () => {
    const conversationId = "conv-123";
    (createServiceClient as ReturnType<typeof vi.fn>).mockReturnValue(
      mockClient({
        rows: [
          {
            id: "orphan-row",
            data: { skills: [] },
            updated_at: "2026-05-17T00:00:00Z",
            conversation_id: null,
          },
        ],
        conversations: [{ id: conversationId }],
      }),
    );

    const { mergeCvSkillsIntoLatestProfile } = await import("@/app/api/cv/confirm/route");
    await mergeCvSkillsIntoLatestProfile("user-1", [
      { id: "python", name_he: "Python", source: "cv" },
    ]);

    expect(capturedUpdate.table).toBe("career_profile");
    expect(capturedUpdate.whereId).toBe("orphan-row");
    expect(
      (capturedUpdate.values as { conversation_id?: string }).conversation_id,
    ).toBe(conversationId);
  });
});
