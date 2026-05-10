import { describe, it, expect } from "vitest";
import { scoreMarket } from "@/lib/matching/score/market";
import type { Occupation } from "@/lib/matching/types";

const occ = (overrides: Partial<Occupation["market"]> = {}): Occupation => ({
  id: "x", title_he: "x", title_en: "x", description_he: "x".repeat(40),
  riasec_affinity: { R: 0, I: 0, A: 0, S: 0, E: 0, C: 0 },
  required_skills: [], desired_skills: [], values_fit: [],
  constraints: {
    typical_training_months: 0, typical_training_cost_nis: 0,
    requires_english_level: "none", remote_ok: false, typical_locations: [],
  },
  market: {
    demand_he: "medium",
    typical_salary_nis_min: 10000,
    typical_salary_nis_max: 20000,
    ai_risk: "low",
    ...overrides,
  },
  data_source: "test", last_verified_at: "2026-01-01",
});

describe("scoreMarket", () => {
  it("returns 100 for very_high demand + low AI risk", () => {
    expect(scoreMarket(occ({ demand_he: "very_high", ai_risk: "low" }))).toBe(100);
  });

  it("returns lower for high demand + high AI risk", () => {
    expect(scoreMarket(occ({ demand_he: "high", ai_risk: "high" }))).toBeLessThan(75);
  });

  it("returns lower still for low demand", () => {
    expect(scoreMarket(occ({ demand_he: "low", ai_risk: "low" }))).toBeLessThan(60);
  });

  it("never depends on user profile (it's a property of the occupation)", () => {
    const a = scoreMarket(occ({ demand_he: "high", ai_risk: "medium" }));
    const b = scoreMarket(occ({ demand_he: "high", ai_risk: "medium" }));
    expect(a).toBe(b);
  });
});
