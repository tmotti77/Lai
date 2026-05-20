import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/analytics", () => ({
  track: vi.fn(),
  npsBucket: vi.fn(),
  questionCountBucket: (n: number) => (n <= 4 ? "1-4" : n <= 8 ? "5-8" : "9+"),
  skillCountBucket: vi.fn(),
}));
vi.mock("@/lib/db/nps", () => ({ markNpsEligibilityIfFirst: vi.fn() }));

const updateChain = {
  eq: vi.fn().mockReturnThis(),
  is: vi.fn().mockReturnThis(),
  select: vi.fn().mockReturnThis(),
  maybeSingle: vi.fn(),
};
vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => ({
    from: () => ({ update: () => updateChain }),
  }),
}));

import { completeInterviewSession } from "@/lib/db/interview";
import { track } from "@/lib/analytics";
import { markNpsEligibilityIfFirst } from "@/lib/db/nps";

beforeEach(() => vi.clearAllMocks());

describe("completeInterviewSession — transition-only emit", () => {
  it("emits interview_completed when row was transitioned", async () => {
    updateChain.maybeSingle.mockResolvedValue({
      data: { user_id: "u-1", persona: "hr", question_count: 7, forced_wrap: false },
      error: null,
    });
    await completeInterviewSession("s-1", {
      summary_he: "x",
      strengths_he: ["x"],
      improvements_he: ["x"],
      next_practice_focus_he: "x",
      per_question: [],
      forcedWrap: false,
    });
    expect(track).toHaveBeenCalledWith("interview_completed", {
      persona: "hr",
      forced_wrap: false,
      question_count_bucket: "5-8",
    });
    expect(markNpsEligibilityIfFirst).toHaveBeenCalledWith("u-1", "interview_completed");
  });

  it("no event when re-called on already-completed session", async () => {
    updateChain.maybeSingle.mockResolvedValue({ data: null, error: null });
    await completeInterviewSession("s-1", {
      summary_he: "x",
      strengths_he: ["x"],
      improvements_he: ["x"],
      next_practice_focus_he: "x",
      per_question: [],
      forcedWrap: false,
    });
    expect(track).not.toHaveBeenCalled();
    expect(markNpsEligibilityIfFirst).not.toHaveBeenCalled();
  });
});
