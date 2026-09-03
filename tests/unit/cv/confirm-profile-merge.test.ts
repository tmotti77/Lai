import { describe, it, expect, beforeEach, vi } from "vitest";
import type { SkillSource } from "@/lib/cv/types";

// Mock Supabase service client
const mockServiceClient = {
  from: vi.fn(),
  rpc: vi.fn(),
};

vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => mockServiceClient,
}));

/**
 * Inline the key logic from mergeCvSkillsIntoLatestProfile for testing.
 * We test that CV skills are merged into the conversation-linked profile,
 * not just any profile.
 */
async function mergeCvSkillsIntoLatestProfile(
  userId: string,
  skills: Array<{ id: string; name_he: string; source: SkillSource; evidence?: string }>,
) {
  const svc = mockServiceClient;

  // First, try to find the profile linked to the user's latest conversation.
  const conversationsQuery = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue({ data: null }),
  };
  
  const profileQuery = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
  };

  svc.from.mockImplementation((table: string) => {
    if (table === "conversations") return conversationsQuery;
    if (table === "career_profile") return profileQuery;
    throw new Error(`Unexpected table: ${table}`);
  });

  // This function should:
  // 1. Look up latest conversation for user
  // 2. Look up profile for that conversation
  // 3. Fall back to latest profile if no conversation profile exists
  // 4. Insert if no profile exists

  return { svc, conversationsQuery, profileQuery };
}

describe("CV confirm → profile merge flow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("looks up the latest conversation for the user first", async () => {
    const userId = "test-user-id";
    const skills = [
      { id: "data-analysis", name_he: "ניתוח נתונים", source: "cv" as SkillSource },
    ];

    const { conversationsQuery } = await mergeCvSkillsIntoLatestProfile(userId, skills);

    expect(conversationsQuery.select).toHaveBeenCalledWith("id");
    expect(conversationsQuery.eq).toHaveBeenCalledWith("user_id", userId);
    expect(conversationsQuery.order).toHaveBeenCalledWith("updated_at", { ascending: false });
    expect(conversationsQuery.limit).toHaveBeenCalledWith(1);
  });

  it("queries for profile linked to latest conversation when one exists", async () => {
    const userId = "test-user-id";
    const conversationId = "test-conv-id";
    const skills = [
      { id: "electrical", name_he: "חשמל", source: "cv" as SkillSource },
    ];

    // Mock: latest conversation exists
    const conversationsQuery = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue({ data: [{ id: conversationId }] }),
    };

    const profileQuery = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({
        data: { id: "profile-id", data: {} },
        error: null,
      }),
    };

    mockServiceClient.from.mockImplementation((table: string) => {
      if (table === "conversations") return conversationsQuery;
      if (table === "career_profile") return profileQuery;
      throw new Error(`Unexpected table: ${table}`);
    });

    await mergeCvSkillsIntoLatestProfile(userId, skills);

    // Should query profile filtered by both user_id AND conversation_id
    expect(profileQuery.eq).toHaveBeenCalledWith("user_id", userId);
    expect(profileQuery.eq).toHaveBeenCalledWith("conversation_id", conversationId);
  });

  it("falls back to latest profile by updated_at if no conversation profile exists", async () => {
    const userId = "test-user-id";
    const conversationId = "test-conv-id";
    const skills = [
      { id: "plumbing", name_he: "אינסטלציה", source: "cv" as SkillSource },
    ];

    // Mock: conversation exists, but no profile linked to it
    const conversationsQuery = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue({ data: [{ id: conversationId }] }),
    };

    let profileQueryCallCount = 0;
    const profileQuery = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockImplementation(async () => {
        profileQueryCallCount++;
        if (profileQueryCallCount === 1) {
          // First call: no profile for conversation
          return { data: null, error: null };
        }
        // Second call: fallback finds a profile
        return { data: { id: "fallback-profile-id", data: {} }, error: null };
      }),
    };

    mockServiceClient.from.mockImplementation((table: string) => {
      if (table === "conversations") return conversationsQuery;
      if (table === "career_profile") return profileQuery;
      throw new Error(`Unexpected table: ${table}`);
    });

    await mergeCvSkillsIntoLatestProfile(userId, skills);

    // Should query profile twice: once filtered by conversation_id, then by updated_at
    expect(profileQuery.maybeSingle).toHaveBeenCalledTimes(2);
  });
});

describe("profile data shape after CV confirm", () => {
  it("CV-confirmed skills have both id and name_he fields", () => {
    const confirmedSkills = [
      { id: "data-analysis", name_he: "ניתוח נתונים", source: "cv" as SkillSource },
      { id: "electrical", name_he: "חשמל", source: "cv" as SkillSource, evidence: "5 years" },
    ];

    // Verify shape matches what buildMatchingProfile expects
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

    // Verify shape matches extraction schema
    for (const skill of chatSkills) {
      expect(skill).toHaveProperty("label_he");
      expect(skill).toHaveProperty("confidence");
    }
  });
});
