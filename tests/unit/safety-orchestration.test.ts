import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the classifier — we control the LLM verdict for each scenario.
// vi.mock factories are hoisted, so we cannot reference outer variables;
// we use vi.mocked() after import to get the typed handle.
vi.mock("@/lib/ai/safety/classifier", () => ({
  classifyMessage: vi.fn(),
}));

// Mock server-only so imports work in test env
vi.mock("server-only", () => ({}));

import { checkUserMessage } from "@/lib/ai/safety";
import { classifyMessage } from "@/lib/ai/safety/classifier";

const classifyMock = vi.mocked(classifyMessage);

beforeEach(() => classifyMock.mockReset());

// `checkUserMessage` is the legal floor — every Hebrew chat turn flows through
// here before any Anthropic call. These tests pin the orchestration logic.
// regex.ts already has its own unit tests for pattern coverage; here we focus
// on the decision tree between regex result + LLM verdict.

describe("checkUserMessage decision tree", () => {
  it("regex crisis → blocks crisis, skips LLM entirely", async () => {
    const decision = await checkUserMessage("אני רוצה למות");
    expect(decision.allow).toBe(false);
    expect(decision).toMatchObject({ allow: false, flag: "crisis" });
    expect(classifyMock).not.toHaveBeenCalled();
  });

  it("regex distress + LLM upgrades to crisis → blocks crisis", async () => {
    classifyMock.mockResolvedValueOnce({ category: "crisis", reasoning: "explicit ideation" });
    const decision = await checkUserMessage("אני בייאוש מוחלט אין לי מי לדבר איתו");
    expect(decision).toMatchObject({ allow: false, flag: "crisis" });
    expect(classifyMock).toHaveBeenCalledTimes(1);
  });

  it("regex distress + LLM clean → still blocks distress (regex is the floor)", async () => {
    classifyMock.mockResolvedValueOnce({ category: "safe", reasoning: "looks ok" });
    const decision = await checkUserMessage("אני בייאוש מוחלט אין לי מי לדבר איתו");
    expect(decision).toMatchObject({ allow: false, flag: "distress" });
  });

  it("regex distress + LLM throws → still blocks distress (fail closed)", async () => {
    classifyMock.mockRejectedValueOnce(new Error("LLM down"));
    const decision = await checkUserMessage("אני בייאוש מוחלט אין לי מי לדבר איתו");
    // .catch(() => null) in index.ts means LLM failures default to null which
    // does NOT upgrade — but the original regex distress hit stands.
    expect(decision).toMatchObject({ allow: false, flag: "distress" });
  });

  it("no regex + short safe message → allows, skips LLM", async () => {
    const decision = await checkUserMessage("אני אחרי צבא");
    expect(decision).toEqual({ allow: true, flag: null });
    expect(classifyMock).not.toHaveBeenCalled();
  });

  it("no regex + long message + LLM crisis → blocks crisis", async () => {
    classifyMock.mockResolvedValueOnce({ category: "crisis", reasoning: "subtle ideation" });
    // 80+ char message to trigger LLM
    const longMsg = "אני מרגיש שאני בקצה והכל הולך לכיוון לא טוב כבר תקופה ארוכה מאוד".repeat(2);
    const decision = await checkUserMessage(longMsg);
    expect(decision).toMatchObject({ allow: false, flag: "crisis" });
    expect(classifyMock).toHaveBeenCalledOnce();
  });

  it("no regex + long message + LLM distress → blocks distress", async () => {
    classifyMock.mockResolvedValueOnce({ category: "distress", reasoning: "emotional pain" });
    const longMsg = "השנה האחרונה הייתה הכי קשה שעברתי ואני לא ממש מצליח להתאושש מזה ".repeat(2);
    const decision = await checkUserMessage(longMsg);
    expect(decision).toMatchObject({ allow: false, flag: "distress" });
  });

  it("no regex + long message + LLM safe → allows", async () => {
    classifyMock.mockResolvedValueOnce({ category: "safe", reasoning: "career venting only" });
    const longMsg = "אני באמת לא יודע מה לעשות עם החיים שלי מקצועית והכל הולך מסביב לי בערפול".repeat(2);
    const decision = await checkUserMessage(longMsg);
    expect(decision).toEqual({ allow: true, flag: null });
    expect(classifyMock).toHaveBeenCalledOnce();
  });

  it("no regex + long message + LLM throws → fail open (allow) on the long-message branch", async () => {
    classifyMock.mockRejectedValueOnce(new Error("LLM timeout"));
    const longMsg = "תיאור ארוך של מצב מקצועי מורכב שלא מכיל מילות מצוקה ".repeat(3);
    const decision = await checkUserMessage(longMsg);
    // No regex hit + LLM error returns null + null category != crisis|distress
    // so it falls through to allow. Documents fail-open behavior on the
    // false-negative-heuristic branch specifically. (Regex remains the floor.)
    expect(decision).toEqual({ allow: true, flag: null });
  });
});
