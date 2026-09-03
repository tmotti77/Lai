import { describe, it, expect } from "vitest";
import { pickPaths } from "@/lib/matching/paths";
import type { Ranking, Occupation } from "@/lib/matching/types";

describe("pickPaths", () => {
  const mockOccupations: Occupation[] = [
    {
      id: "hvac-tech",
      title_he: "טכנאי מיזוג אוויר",
      title_en: "HVAC Technician",
      description_he: "מתקין ומתחזק מערכות מיזוג",
      riasec_affinity: { R: 0.9, I: 0.3, A: 0.1, S: 0.4, E: 0.2, C: 0.3 },
      required_skills: [],
      desired_skills: [],
      values_fit: ["stability"],
      constraints: {
        typical_training_months: 6,
        typical_training_cost_nis: 15000,
        requires_english_level: "basic",
        remote_ok: false,
        typical_locations: ["center"],
      },
      market: {
        demand_he: "high",
        typical_salary_nis_min: 8000,
        typical_salary_nis_max: 15000,
        ai_risk: "low",
      },
      data_source: "test",
      last_verified_at: "2026-05-01",
    },
    {
      id: "electrician",
      title_he: "חשמלאי",
      title_en: "Electrician",
      description_he: "מבצע עבודות חשמל",
      riasec_affinity: { R: 0.9, I: 0.4, A: 0.1, S: 0.3, E: 0.2, C: 0.3 },
      required_skills: [],
      desired_skills: [],
      values_fit: ["stability"],
      constraints: {
        typical_training_months: 12,
        typical_training_cost_nis: 25000,
        requires_english_level: "basic",
        remote_ok: false,
        typical_locations: ["center"],
      },
      market: {
        demand_he: "high",
        typical_salary_nis_min: 9000,
        typical_salary_nis_max: 18000,
        ai_risk: "low",
      },
      data_source: "test",
      last_verified_at: "2026-05-01",
    },
    {
      id: "plumber",
      title_he: "אינסטלטור",
      title_en: "Plumber",
      description_he: "מתקין ומתקן מערכות אינסטלציה",
      riasec_affinity: { R: 0.9, I: 0.3, A: 0.1, S: 0.4, E: 0.2, C: 0.2 },
      required_skills: [],
      desired_skills: [],
      values_fit: ["autonomy"],
      constraints: {
        typical_training_months: 9,
        typical_training_cost_nis: 20000,
        requires_english_level: "none",
        remote_ok: false,
        typical_locations: ["center"],
      },
      market: {
        demand_he: "medium",
        typical_salary_nis_min: 8000,
        typical_salary_nis_max: 16000,
        ai_risk: "low",
      },
      data_source: "test",
      last_verified_at: "2026-05-01",
    },
  ];

  it("fills growth path when interests is null but total_score is high (chat+CV profile)", () => {
    const rankings: Ranking[] = [
      {
        occupation_id: "hvac-tech",
        total_score: 82,
        breakdown: {
          interests: null, // No RIASEC assessment
          skills: 85,
          values: null,
          big5: null,
          constraints: 90,
          market: 75,
        },
        weights_used: { skills: 40, constraints: 40, market: 20 },
      },
      {
        occupation_id: "electrician",
        total_score: 78,
        breakdown: {
          interests: null,
          skills: 82,
          values: null,
          big5: null,
          constraints: 85,
          market: 70,
        },
        weights_used: { skills: 40, constraints: 40, market: 20 },
      },
      {
        occupation_id: "plumber",
        total_score: 72,
        breakdown: {
          interests: null,
          skills: 75,
          values: null,
          big5: null,
          constraints: 80,
          market: 65,
        },
        weights_used: { skills: 40, constraints: 40, market: 20 },
      },
    ];

    const paths = pickPaths(rankings, mockOccupations);

    // Safe: hvac-tech (constraints 90, training ≤12mo, high demand, total 82 ≥70)
    expect(paths.safe).toBe("hvac-tech");
    
    // Growth: electrician (no interests but total 78 ≥70, training 12mo in 6-24 range, high demand)
    // Should NOT be null even though interests is null
    expect(paths.growth).toBe("electrician");
    
    // Wildcard: plumber (total 72 ≥60)
    expect(paths.wildcard).toBe("plumber");
  });

  it("uses interests threshold when interests dimension exists", () => {
    const rankings: Ranking[] = [
      {
        occupation_id: "hvac-tech",
        total_score: 75,
        breakdown: {
          interests: 55, // Below 65 threshold
          skills: 85,
          values: 70,
          big5: null,
          constraints: 90,
          market: 75,
        },
        weights_used: { interests: 25, skills: 20, values: 15, constraints: 30, market: 10 },
      },
      {
        occupation_id: "electrician",
        total_score: 78,
        breakdown: {
          interests: 68, // Above 65 threshold
          skills: 82,
          values: 72,
          big5: null,
          constraints: 85,
          market: 70,
        },
        weights_used: { interests: 25, skills: 20, values: 15, constraints: 30, market: 10 },
      },
    ];

    const paths = pickPaths(rankings, mockOccupations);

    // hvac-tech should be safe (constraints 90, training 6mo, high demand, total 75 ≥70)
    expect(paths.safe).toBe("hvac-tech");
    
    // Growth should prefer electrician (interests 68 ≥65, not hvac which is already used)
    expect(paths.growth).toBe("electrician");
  });

  it("returns null growth when no occupation meets criteria", () => {
    const rankings: Ranking[] = [
      {
        occupation_id: "hvac-tech",
        total_score: 82,
        breakdown: {
          interests: null,
          skills: 85,
          values: null,
          big5: null,
          constraints: 90,
          market: 75,
        },
        weights_used: { skills: 40, constraints: 40, market: 20 },
      },
    ];

    const paths = pickPaths(rankings, mockOccupations);

    // Only hvac-tech used by safe, no other candidates for growth
    expect(paths.safe).toBe("hvac-tech");
    expect(paths.growth).toBeNull();
  });
});
