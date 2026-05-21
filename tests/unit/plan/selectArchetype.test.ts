import { describe, it, expect } from "vitest";
import { selectArchetype } from "@/lib/plan/selectArchetype";
import type { Paths } from "@/lib/matching/types";

// Archetype determines the personality of the 30-day plan:
//   apply       — the user has a clear safe target. Plan optimizes for landing it.
//   taste_test  — the user has a growth-target. Plan optimizes for trying the field.
//   research    — the user has only a wildcard. Plan optimizes for exploration.
//   null        — all three path slots failed; no plan can be archetyped.
//
// Priority order is intentional: safe > growth > wildcard. If a user has any
// safe option, the plan should help them land it before testing growth/wildcard
// paths. These tests pin that ordering.

describe("selectArchetype", () => {
  it("picks apply when only safe is set", () => {
    const paths: Paths = { safe: "data-analyst", growth: null, wildcard: null };
    expect(selectArchetype(paths)).toBe("apply");
  });

  it("picks apply when safe + growth + wildcard all set (safe wins)", () => {
    const paths: Paths = { safe: "data-analyst", growth: "product-manager", wildcard: "ux-designer" };
    expect(selectArchetype(paths)).toBe("apply");
  });

  it("picks taste_test when safe is null but growth is set", () => {
    const paths: Paths = { safe: null, growth: "product-manager", wildcard: null };
    expect(selectArchetype(paths)).toBe("taste_test");
  });

  it("picks taste_test when safe is null but growth + wildcard set (growth wins)", () => {
    const paths: Paths = { safe: null, growth: "product-manager", wildcard: "ux-designer" };
    expect(selectArchetype(paths)).toBe("taste_test");
  });

  it("picks research when only wildcard is set", () => {
    const paths: Paths = { safe: null, growth: null, wildcard: "ux-designer" };
    expect(selectArchetype(paths)).toBe("research");
  });

  it("returns null when all three slots are null (no qualifying occupations)", () => {
    const paths: Paths = { safe: null, growth: null, wildcard: null };
    expect(selectArchetype(paths)).toBeNull();
  });
});
