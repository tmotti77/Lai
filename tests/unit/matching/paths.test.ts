import { describe, it, expect } from "vitest";
import { pickPaths } from "@/lib/matching/paths";
import type { Ranking, Occupation } from "@/lib/matching/types";

const fakeOcc = (overrides: Partial<Occupation> & { id: string }): Occupation => ({
  id: overrides.id, title_he: overrides.id, title_en: overrides.id, description_he: "x".repeat(40),
  riasec_affinity: overrides.riasec_affinity ?? { R: 0.5, I: 0.5, A: 0.5, S: 0.5, E: 0.5, C: 0.5 },
  required_skills: [], desired_skills: [], values_fit: [],
  constraints: overrides.constraints ?? {
    typical_training_months: 6, typical_training_cost_nis: 0,
    requires_english_level: "none", remote_ok: false, typical_locations: [],
  },
  market: overrides.market ?? { demand_he: "high", typical_salary_nis_min: 0, typical_salary_nis_max: 0, ai_risk: "low" },
  data_source: "test", last_verified_at: "2026-01-01",
});

const rank = (id: string, total: number, breakdown: Partial<Ranking["breakdown"]>): Ranking => ({
  occupation_id: id,
  total_score: total,
  breakdown: { interests: null, skills: null, values: null, big5: null, constraints: null, market: null, ...breakdown },
  weights_used: {},
});

describe("pickPaths", () => {
  it("picks safe = highest with constraints>=75 + short training + high demand", () => {
    const occs = [
      fakeOcc({ id: "long-train", constraints: { typical_training_months: 24, typical_training_cost_nis: 0, requires_english_level: "none", remote_ok: false, typical_locations: [] } }),
      fakeOcc({ id: "short-train", constraints: { typical_training_months: 3, typical_training_cost_nis: 0, requires_english_level: "none", remote_ok: false, typical_locations: [] } }),
    ];
    const rankings = [
      rank("long-train", 80, { constraints: 90, interests: 70 }),
      rank("short-train", 70, { constraints: 85, interests: 70 }),
    ];
    const paths = pickPaths(rankings, occs);
    expect(paths.safe).toBe("short-train");
  });

  it("picks growth = next-best with interests>=70 and 6-18 month training", () => {
    const occs = [
      fakeOcc({ id: "safe-pick", constraints: { typical_training_months: 3, typical_training_cost_nis: 0, requires_english_level: "none", remote_ok: false, typical_locations: [] } }),
      fakeOcc({ id: "growth-pick", constraints: { typical_training_months: 12, typical_training_cost_nis: 0, requires_english_level: "none", remote_ok: false, typical_locations: [] } }),
      fakeOcc({ id: "too-long", constraints: { typical_training_months: 36, typical_training_cost_nis: 0, requires_english_level: "none", remote_ok: false, typical_locations: [] } }),
    ];
    const rankings = [
      rank("safe-pick", 90, { constraints: 90, interests: 80 }),
      rank("growth-pick", 80, { constraints: 60, interests: 80 }),
      rank("too-long", 75, { constraints: 60, interests: 80 }),
    ];
    const paths = pickPaths(rankings, occs);
    expect(paths.safe).toBe("safe-pick");
    expect(paths.growth).toBe("growth-pick");
  });

  it("returns null in slots with no qualifying occupation", () => {
    const occs = [fakeOcc({ id: "x", constraints: { typical_training_months: 36, typical_training_cost_nis: 0, requires_english_level: "none", remote_ok: false, typical_locations: [] }, market: { demand_he: "low", typical_salary_nis_min: 0, typical_salary_nis_max: 0, ai_risk: "low" } })];
    const rankings = [rank("x", 40, { interests: 30, constraints: 30 })];
    const paths = pickPaths(rankings, occs);
    expect(paths.safe).toBeNull();
    expect(paths.growth).toBeNull();
    expect(paths.wildcard).toBeNull();
  });

  it("never reuses an occupation across paths", () => {
    const occs = [
      fakeOcc({ id: "a", constraints: { typical_training_months: 3, typical_training_cost_nis: 0, requires_english_level: "none", remote_ok: false, typical_locations: [] } }),
    ];
    const rankings = [rank("a", 95, { interests: 90, constraints: 90 })];
    const paths = pickPaths(rankings, occs);
    expect(paths.safe).toBe("a");
    expect(paths.growth).toBeNull();
    expect(paths.wildcard).toBeNull();
  });
});
