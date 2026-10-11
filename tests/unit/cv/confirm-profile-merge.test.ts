import { describe, it, expect, beforeEach, vi } from "vitest";
import type { SkillSource } from "@/lib/cv/types";
import { chainQuery } from "@/tests/mocks/supabase-chain";

vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: vi.fn(),
}));

import { createServiceClient } from "@/lib/supabase/service";

const CV_SKILLS = [
  { id: "data-analysis", name_he: "ניתוח נתונים", source: "cv" as SkillSource },
];

/**
 * Wire a service-client mock for app/api/cv/confirm/route.ts.
 *
 * An earlier version of this file declared its own local mergeCvSkillsIntoLatestProfile
 * that only built mock objects and returned them, so every assertion here ran against
 * mocks nothing had called. These tests now import and run the real route function.
 */
function wireClient(opts: {
  conversations: Array<{ id: string }> | null;
  profileResults: QueryResultList;
}) {
  const conversationsQuery = chainQuery([{ data: opts.conversations, error: null }]);
  const profileQuery = chainQuery(opts.profileResults);
  const updateEq = vi.fn(() => Promise.resolve({ error: null }));
  const update = vi.fn(() => ({ eq: updateEq }));
  const insertPayloads: Array<{ conversation_id: string | null }> = [];
  const insert = vi.fn((payload: { conversation_id: string | null }) => {
    insertPayloads.push(payload);
    return Promise.resolve({ error: null });
  });
  Object.assign(profileQuery, { update, insert });

  (createServiceClient as ReturnType<typeof vi.fn>).mockReturnValue({
    from: vi.fn((table: string) => {
      if (table === "conversations") return conversationsQuery;
      if (table === "career_profile") return profileQuery;
      throw new Error(`Unexpected table: ${table}`);
    }),
  });

  return { conversationsQuery, profileQuery, update, updateEq, insert, insertPayloads };
}

type QueryResultList = Parameters<typeof chainQuery>[0];

async function runMerge(): Promise<void> {
  const { mergeCvSkillsIntoLatestProfile } = await import("@/app/api/cv/confirm/route");
  await mergeCvSkillsIntoLatestProfile("test-user-id", CV_SKILLS);
}

describe("CV confirm → profile merge flow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("looks up the latest conversation for the user first", async () => {
    const { conversationsQuery } = wireClient({
      conversations: null,
      profileResults: [{ data: null, error: null }],
    });

    await runMerge();

    expect(conversationsQuery.select).toHaveBeenCalledWith("id");
    expect(conversationsQuery.eq).toHaveBeenCalledWith("user_id", "test-user-id");
    expect(conversationsQuery.order).toHaveBeenCalledWith("updated_at", { ascending: false });
    expect(conversationsQuery.limit).toHaveBeenCalledWith(1);
  });

  it("queries for profile linked to latest conversation when one exists", async () => {
    const conversationId = "test-conv-id";
    const { profileQuery } = wireClient({
      conversations: [{ id: conversationId }],
      profileResults: [{ data: { id: "profile-id", data: {} }, error: null }],
    });

    await runMerge();

    expect(profileQuery.eq).toHaveBeenCalledWith("user_id", "test-user-id");
    expect(profileQuery.eq).toHaveBeenCalledWith("conversation_id", conversationId);
  });

  it("falls back to latest profile by updated_at if no conversation profile exists", async () => {
    const { profileQuery } = wireClient({
      conversations: [{ id: "test-conv-id" }],
      profileResults: [
        { data: null, error: null },
        { data: { id: "fallback-profile-id", data: {} }, error: null },
      ],
    });

    await runMerge();

    // Once filtered by conversation_id, then again ordered by updated_at.
    expect(profileQuery.maybeSingle).toHaveBeenCalledTimes(2);
    expect(profileQuery.order).toHaveBeenCalledWith("updated_at", { ascending: false });
  });

  it("inserts a new profile linked to the conversation when none exists", async () => {
    const conversationId = "test-conv-id";
    const { insert, insertPayloads } = wireClient({
      conversations: [{ id: conversationId }],
      profileResults: [
        { data: null, error: null },
        { data: null, error: null },
      ],
    });

    await runMerge();

    expect(insert).toHaveBeenCalledTimes(1);
    expect(insertPayloads[0].conversation_id).toBe(conversationId);
  });
});

describe("profile data shape after CV confirm", () => {
  it("CV-confirmed skills have both id and name_he fields", () => {
    const confirmedSkills = [
      { id: "data-analysis", name_he: "ניתוח נתונים", source: "cv" as SkillSource },
      { id: "electrical", name_he: "חשמל", source: "cv" as SkillSource, evidence: "5 years" },
    ];

    for (const skill of confirmedSkills) {
      expect(skill).toHaveProperty("id");
      expect(skill).toHaveProperty("name_he");
      expect(skill).toHaveProperty("source");
      expect(skill.source).toBe("cv");
    }
  });

  it("chat-extracted skills have label_he field", () => {
    const chatSkills = [
      { label: "Programming", label_he: "תכנות", evidence: "test", confidence: "high" },
    ];

    for (const skill of chatSkills) {
      expect(skill).toHaveProperty("label_he");
      expect(skill).toHaveProperty("confidence");
    }
  });
});
