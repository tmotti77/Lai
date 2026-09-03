import { describe, it, expect } from "vitest";
import { pickPaths } from "@/lib/matching/paths";
import type { Ranking, Occupation } from "@/lib/matching/types";

const fakeOcc = (overrides: Partial<Occupation> & { id: string }): Occupation => ({
  id: overrides.id,
  title_he: overrides.id,
  title_en: overrides.id,
  description_he: "x".repeat(40),
  riasec_affinity: overrides.riasec_affinity ?? { R: 0.9, I: 0.5, A: 0.2, S: 0.3, E: 0.3, C: 0.6 },
  required_skills: [],
  desired_skills: [],
  values_fit: [],
  constraints: overrides.constraints ?? {
    typical_training_months: 12,
    typical_training_cost_nis: 12000,
    requires_english_level: "none",
    remote_ok: false,
    typical_locations: [],
  },
  market: overrides.market ?? {
    demand_he: "high",
    typical_salary_nis_min: 10000,
    typical_salary_nis_max: 25000,
    ai_risk: "low",
  },
  data_source: "test",
  last_verified_at: "2026-09-03",
});

const rank = (id: string, total: number, breakdown: Partial<Ranking["breakdown"]>): Ranking => ({
  occupation_id: id,
  total_score: total,
  breakdown: {
    interests: null,
    skills: null,
    values: null,
    big5: null,
    constraints: null,
    market: null,
    ...breakdown,
  },
  weights_used: {},
});

describe("hands-on post-army matching", () => {
  it("should match electrician as safe path for post-army hands-on profile", () => {
    const occs = [
      fakeOcc({
        id: "electrician",
        constraints: {
          typical_training_months: 12,
          typical_training_cost_nis: 12000,
          requires_english_level: "none",
          remote_ok: false,
          typical_locations: [],
        },
        market: { demand_he: "high", typical_salary_nis_min: 12000, typical_salary_nis_max: 25000, ai_risk: "low" },
      }),
      fakeOcc({
        id: "product-manager",
        constraints: {
          typical_training_months: 3,
          typical_training_cost_nis: 8000,
          requires_english_level: "intermediate",
          remote_ok: true,
          typical_locations: [],
        },
        market: { demand_he: "high", typical_salary_nis_min: 18000, typical_salary_nis_max: 35000, ai_risk: "medium" },
        riasec_affinity: { R: 0.2, I: 0.6, A: 0.4, S: 0.5, E: 0.8, C: 0.5 },
      }),
    ];

    const rankings = [
      rank("electrician", 82, { constraints: 75, interests: 80, skills: 85 }),
      rank("product-manager", 78, { constraints: 60, interests: 70, skills: 65 }),
    ];

    const paths = pickPaths(rankings, occs);
    
    expect(paths.safe).toBe("electrician");
  });

  it("should match HVAC technician with 9 months training as safe path", () => {
    const occs = [
      fakeOcc({
        id: "hvac-technician",
        constraints: {
          typical_training_months: 9,
          typical_training_cost_nis: 12000,
          requires_english_level: "none",
          remote_ok: false,
          typical_locations: [],
        },
        market: { demand_he: "high", typical_salary_nis_min: 11000, typical_salary_nis_max: 26000, ai_risk: "low" },
      }),
      fakeOcc({
        id: "ml-engineer",
        constraints: {
          typical_training_months: 18,
          typical_training_cost_nis: 25000,
          requires_english_level: "advanced",
          remote_ok: true,
          typical_locations: [],
        },
        market: { demand_he: "high", typical_salary_nis_min: 25000, typical_salary_nis_max: 50000, ai_risk: "high" },
        riasec_affinity: { R: 0.3, I: 0.95, A: 0.2, S: 0.2, E: 0.3, C: 0.6 },
      }),
    ];

    const rankings = [
      rank("hvac-technician", 80, { constraints: 78, interests: 85, skills: 80 }),
      rank("ml-engineer", 75, { constraints: 50, interests: 90, skills: 70 }),
    ];

    const paths = pickPaths(rankings, occs);
    
    expect(paths.safe).toBe("hvac-technician");
  });

  it("should match plumber as growth path with 18 months training", () => {
    const occs = [
      fakeOcc({
        id: "security-systems-installer",
        constraints: {
          typical_training_months: 6,
          typical_training_cost_nis: 8000,
          requires_english_level: "basic",
          remote_ok: false,
          typical_locations: [],
        },
        market: { demand_he: "high", typical_salary_nis_min: 10000, typical_salary_nis_max: 24000, ai_risk: "low" },
      }),
      fakeOcc({
        id: "plumber",
        constraints: {
          typical_training_months: 18,
          typical_training_cost_nis: 15000,
          requires_english_level: "none",
          remote_ok: false,
          typical_locations: [],
        },
        market: { demand_he: "high", typical_salary_nis_min: 10000, typical_salary_nis_max: 28000, ai_risk: "low" },
      }),
    ];

    const rankings = [
      rank("security-systems-installer", 85, { constraints: 80, interests: 75, skills: 80 }),
      rank("plumber", 78, { constraints: 65, interests: 80, skills: 75 }),
    ];

    const paths = pickPaths(rankings, occs);
    
    expect(paths.safe).toBe("security-systems-installer");
    expect(paths.growth).toBe("plumber");
  });

  it("should not match PM+ML Engineer for hands-on profile", () => {
    const occs = [
      fakeOcc({
        id: "hvac-technician",
        riasec_affinity: { R: 0.95, I: 0.45, A: 0.10, S: 0.25, E: 0.35, C: 0.60 },
        constraints: {
          typical_training_months: 9,
          typical_training_cost_nis: 12000,
          requires_english_level: "none",
          remote_ok: false,
          typical_locations: [],
        },
        market: { demand_he: "high", typical_salary_nis_min: 11000, typical_salary_nis_max: 26000, ai_risk: "low" },
      }),
      fakeOcc({
        id: "product-manager",
        riasec_affinity: { R: 0.2, I: 0.6, A: 0.4, S: 0.5, E: 0.8, C: 0.5 },
        constraints: {
          typical_training_months: 3,
          typical_training_cost_nis: 8000,
          requires_english_level: "intermediate",
          remote_ok: true,
          typical_locations: [],
        },
        market: { demand_he: "high", typical_salary_nis_min: 18000, typical_salary_nis_max: 35000, ai_risk: "medium" },
      }),
      fakeOcc({
        id: "ml-engineer",
        riasec_affinity: { R: 0.3, I: 0.95, A: 0.2, S: 0.2, E: 0.3, C: 0.6 },
        constraints: {
          typical_training_months: 18,
          typical_training_cost_nis: 25000,
          requires_english_level: "advanced",
          remote_ok: true,
          typical_locations: [],
        },
        market: { demand_he: "high", typical_salary_nis_min: 25000, typical_salary_nis_max: 50000, ai_risk: "high" },
      }),
    ];

    // Hands-on profile scores should favor HVAC over PM/ML
    const rankings = [
      rank("hvac-technician", 82, { constraints: 75, interests: 85, skills: 80 }),
      rank("product-manager", 65, { constraints: 60, interests: 50, skills: 60 }),
      rank("ml-engineer", 60, { constraints: 40, interests: 55, skills: 55 }),
    ];

    const paths = pickPaths(rankings, occs);
    
    expect(paths.safe).toBe("hvac-technician");
    expect(paths.safe).not.toBe("product-manager");
    expect(paths.safe).not.toBe("ml-engineer");
  });
});
