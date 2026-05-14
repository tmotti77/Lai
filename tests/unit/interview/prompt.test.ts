import { describe, it, expect } from "vitest";
import { composeSystemPrompt, composeTurnPreamble } from "@/lib/interview/prompt";

describe("composeSystemPrompt", () => {
  it("substitutes target_role_he and includes persona overlay", () => {
    const s = composeSystemPrompt({
      persona: "hr",
      targetRoleHe: "מהנדס/ת תוכנה",
      occupationSkills: null,
    });
    expect(s).toContain("מהנדס/ת תוכנה");
    expect(s).toContain("משאבי אנוש"); // HR persona label
    expect(s).toContain("עברית ניטרלית מגדרית"); // base rule 7
  });

  it("technical persona injects occupation skills when provided", () => {
    const s = composeSystemPrompt({
      persona: "technical",
      targetRoleHe: "מהנדס/ת תוכנה",
      occupationSkills: ["Python", "מערכות מבוזרות", "SQL"],
    });
    expect(s).toContain("Python");
    expect(s).toContain("מערכות מבוזרות");
    expect(s).toContain("SQL");
  });

  it("contains NO per-turn variables (cache correctness)", () => {
    const s = composeSystemPrompt({
      persona: "technical",
      targetRoleHe: "מהנדס/ת תוכנה",
      occupationSkills: null,
    });
    // System prompt must not mention "שאלה N" or digit-counter substrings
    // (those live in the per-turn preamble).
    expect(s).not.toMatch(/שאלה\s*\d+/);
    expect(s).not.toMatch(/מתוך\s*\d+/);
  });
});

describe("composeTurnPreamble", () => {
  it("emits Mode A (asking) when question_count < max_questions", () => {
    const a = composeTurnPreamble({ questionCount: 0, maxQuestions: 8 });
    expect(a).toContain("שאלה 1 מתוך 8");

    const b = composeTurnPreamble({ questionCount: 5, maxQuestions: 8 });
    expect(b).toContain("שאלה 6 מתוך 8");

    // Must NOT be wrap mode yet.
    expect(b).not.toContain("wrap_up");
  });

  it("emits Mode B (wrap instruction) when question_count >= max_questions", () => {
    const c = composeTurnPreamble({ questionCount: 8, maxQuestions: 8 });
    expect(c).toContain("wrap_up");
    expect(c).toContain("הראיון הסתיים");
    expect(c).not.toMatch(/שאלה\s*9\s*מתוך/); // no off-by-one!
  });

  it("Mode B applies above max too (defensive)", () => {
    const d = composeTurnPreamble({ questionCount: 12, maxQuestions: 8 });
    expect(d).toContain("wrap_up");
  });
});
