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
    // Use deliberately-fictional ids that must NEVER be added to the taxonomy.
    // The original regression test used "curriculum-design" — which then
    // landed in the taxonomy via a parallel PR, inverting this assertion.
    // The "-test-fake" suffix telegraphs "do not add me" to future maintainers.
    const input = [mk("nonexistent-test-fake-skill"), mk("foo-bar-baz-test-fake")];
    const result = canonicalizeExtractedSkills(input);
    expect(result.map((s) => s.id)).toEqual([
      "other:nonexistent-test-fake-skill",
      "other:foo-bar-baz-test-fake",
    ]);
  });

  it("preserves confidence and evidence when rewriting", () => {
    const input = [mk("invented-id-test-fake", 0.92, "exact CV phrase")];
    const result = canonicalizeExtractedSkills(input);
    expect(result[0]).toEqual({
      id: "other:invented-id-test-fake",
      confidence: 0.92,
      evidence: "exact CV phrase",
    });
  });

  it("handles empty input", () => {
    expect(canonicalizeExtractedSkills([])).toEqual([]);
  });

  it("preserves order", () => {
    const input = [
      mk("invented-1-test-fake"),
      mk("teaching"),
      mk("invented-2-test-fake"),
      mk("other:custom"),
    ];
    const result = canonicalizeExtractedSkills(input);
    expect(result.map((s) => s.id)).toEqual([
      "other:invented-1-test-fake",
      "teaching",
      "other:invented-2-test-fake",
      "other:custom",
    ]);
  });
});
