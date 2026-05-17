import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: vi.fn(),
}));

import { createServiceClient } from "@/lib/supabase/service";

let capturedUpdate: { table?: string; values?: unknown; whereId?: string } = {};

function mockClient(rows: Array<{ id: string; data: unknown; updated_at: string }>) {
  return {
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          order: () => ({
            limit: () => ({
              maybeSingle: () => Promise.resolve({ data: rows[0] ?? null, error: null }),
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
    }),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  capturedUpdate = {};
});

describe("cv confirm: multi-row update scoping", () => {
  it("picks the latest career_profile row and updates by its id", async () => {
    (createServiceClient as ReturnType<typeof vi.fn>).mockReturnValue(
      mockClient([
        { id: "row-LATEST", data: { skills: [] }, updated_at: "2026-05-17T00:00:00Z" },
      ]),
    );

    const { mergeCvSkillsIntoLatestProfile } = await import("@/app/api/cv/confirm/route");
    await mergeCvSkillsIntoLatestProfile("user-1", [
      { id: "python", name_he: "Python", source: "cv" },
    ]);

    expect(capturedUpdate.table).toBe("career_profile");
    expect(capturedUpdate.whereId).toBe("row-LATEST");
    expect((capturedUpdate.values as { data: { skills: unknown[] } }).data.skills).toHaveLength(1);
  });
});
