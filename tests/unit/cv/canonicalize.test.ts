import { describe, it, expect } from "vitest";
import { canonicalizeExtractedSkills } from "@/lib/cv/canonicalize";
import type { ExtractedSkill } from "@/lib/cv/types";

const mk = (id: string, confidence = 0.8, evidence = "..."): ExtractedSkill => ({
  id,
  confidence,
  evidence,
});

describe("canonicalizeExtractedSkills", () => {
  it("passes through ids that exist in the taxonomy", () => {
    const input = [mk("teaching"), mk("python"), mk("communication")];
    const result = canonicalizeExtractedSkills(input);
    expect(result.map((s) => s.id)).toEqual(["teaching", "python", "communication"]);
  });

  it("passes through ids already prefixed with other:", () => {
    const input = [mk("other:ניווט בשטח"), mk("other:bagrut prep")];
    const result = canonicalizeExtractedSkills(input);
    expect(result.map((s) => s.id)).toEqual(["other:ניווט בשטח", "other:bagrut prep"]);
  });

  it("rewrites unknown taxonomy-shaped ids to other:<id>", () => {
    // Regression for the curriculum-design hallucination observed in E2E
    // testing with the teacher fixture before the taxonomy entry was added.
    const input = [mk("curriculum-design"), mk("foo-bar-baz")];
    const result = canonicalizeExtractedSkills(input);
    expect(result.map((s) => s.id)).toEqual(["other:curriculum-design", "other:foo-bar-baz"]);
  });

  it("preserves confidence and evidence when rewriting", () => {
    const input = [mk("invented-id", 0.92, "exact CV phrase")];
    const result = canonicalizeExtractedSkills(input);
    expect(result[0]).toEqual({
      id: "other:invented-id",
      confidence: 0.92,
      evidence: "exact CV phrase",
    });
  });

  it("handles empty input", () => {
    expect(canonicalizeExtractedSkills([])).toEqual([]);
  });

  it("preserves order", () => {
    const input = [
      mk("invented-1"),
      mk("teaching"),
      mk("invented-2"),
      mk("other:custom"),
    ];
    const result = canonicalizeExtractedSkills(input);
    expect(result.map((s) => s.id)).toEqual([
      "other:invented-1",
      "teaching",
      "other:invented-2",
      "other:custom",
    ]);
  });
});
