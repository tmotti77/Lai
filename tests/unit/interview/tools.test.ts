import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db/interview", () => ({
  completeInterviewSession: vi.fn(),
}));

import { completeInterviewSession } from "@/lib/db/interview";
import { makeWrapUpTool } from "@/lib/interview/tools";

const validInput = {
  summary_he: "סיכמת את התקופה האחרונה בצורה ברורה ומבוססת על דוגמאות.",
  strengths_he: ["נימוק טוב", "דוגמאות קונקרטיות"],
  improvements_he: ["שאלות הבהרה", "סדר בתשובה"],
  next_practice_focus_he: "תרגל מענה על שאלות התנהגותיות עם מבנה STAR.",
  per_question: [
    { question_number: 1, note_he: "מענה טוב, חסרה דוגמה." },
    { question_number: 2, note_he: "ברור ומדויק." },
  ],
};

beforeEach(() => vi.clearAllMocks());

describe("makeWrapUpTool", () => {
  it("rejects when called before question 5 (too_early)", async () => {
    const tool = makeWrapUpTool("session-1", 3);
    const result = await tool.execute!(validInput, { toolCallId: "t1", messages: [] } as never);
    expect(result).toEqual(
      expect.objectContaining({ wrapped: false, error: "too_early" }),
    );
    expect(completeInterviewSession).not.toHaveBeenCalled();
  });

  it("writes feedback and returns wrapped:true when called at or after question 5", async () => {
    const tool = makeWrapUpTool("session-1", 6);
    const result = await tool.execute!(validInput, { toolCallId: "t1", messages: [] } as never);
    expect(result).toEqual({ wrapped: true });
    expect(completeInterviewSession).toHaveBeenCalledWith("session-1", expect.objectContaining(validInput));
  });
});
