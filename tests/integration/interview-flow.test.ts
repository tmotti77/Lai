import { describe, it, expect } from "vitest";
import { composeTurnPreamble } from "@/lib/interview/prompt";

const HAS_KEY = !!process.env.ANTHROPIC_API_KEY;

describe.skipIf(!HAS_KEY)("interview flow (integration, requires ANTHROPIC_API_KEY)", () => {
  it("preamble mode switches at the cap", () => {
    expect(composeTurnPreamble({ questionCount: 7, maxQuestions: 8 })).toContain(
      "שאלה 8 מתוך 8",
    );
    expect(composeTurnPreamble({ questionCount: 8, maxQuestions: 8 })).toContain(
      "wrap_up",
    );
  });

  // The full streaming round-trip is exercised by scripts/e2e-test-interview.ts,
  // which talks to a real DB + real Anthropic API. Keeping unit-level tests
  // here and a manual e2e script avoids flaky CI integration runs.
});
