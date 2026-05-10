import { describe, it, expect } from "vitest";
import { STAGES, isValidStage, getNextStage } from "@/lib/ai/stages";

describe("stages", () => {
  it("STAGES is the canonical 7-stage ordered list", () => {
    expect(STAGES).toEqual([
      "onboarding",
      "interests",
      "skills",
      "values",
      "constraints",
      "wrap",
      "complete",
    ]);
  });

  it("isValidStage accepts all canonical stages", () => {
    for (const s of STAGES) expect(isValidStage(s)).toBe(true);
  });

  it("isValidStage rejects unknown values", () => {
    expect(isValidStage("hello")).toBe(false);
    expect(isValidStage("")).toBe(false);
    expect(isValidStage(null as unknown as string)).toBe(false);
  });

  it("getNextStage returns the next stage in order", () => {
    expect(getNextStage("onboarding")).toBe("interests");
    expect(getNextStage("interests")).toBe("skills");
    expect(getNextStage("skills")).toBe("values");
    expect(getNextStage("values")).toBe("constraints");
    expect(getNextStage("constraints")).toBe("wrap");
    expect(getNextStage("wrap")).toBe("complete");
  });

  it("getNextStage on complete returns null", () => {
    expect(getNextStage("complete")).toBeNull();
  });
});
