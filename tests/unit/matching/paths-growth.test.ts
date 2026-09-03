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
    
    // Growth: electrician (no interests but total 78 ≥60, training 12mo in 3-36 range, high demand)
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

  it("returns null growth when only one candidate exists (used by safe)", () => {
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

  it("fills growth with 60-69 score when interests is null (closes gap with wildcard)", () => {
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
      {
        occupation_id: "electrician",
        total_score: 65, // In the 60-69 gap
        breakdown: {
          interests: null,
          skills: 70,
          values: null,
          big5: null,
          constraints: 75,
          market: 60,
        },
        weights_used: { skills: 40, constraints: 40, market: 20 },
      },
      {
        occupation_id: "plumber",
        total_score: 62, // Also in gap
        breakdown: {
          interests: null,
          skills: 68,
          values: null,
          big5: null,
          constraints: 70,
          market: 58,
        },
        weights_used: { skills: 40, constraints: 40, market: 20 },
      },
    ];

    const paths = pickPaths(rankings, mockOccupations);

    // Safe: hvac-tech (constraints 90, training 6mo, high demand, total 82 ≥70)
    expect(paths.safe).toBe("hvac-tech");
    
    // Growth: electrician (total 65 ≥60, training 12mo in 3-36 range, high demand)
    // Previously this would be null (70 threshold), now filled (60 threshold)
    expect(paths.growth).toBe("electrician");
    
    // Wildcard: plumber (total 62 ≥60)
    expect(paths.wildcard).toBe("plumber");
  });

  it("uses fallback guarantee when no occupation meets primary growth criteria", () => {
    // All occupations have very short training (< 3 months) so they don't match primary growth
    const shortTrainingOccs: Occupation[] = [
      {
        id: "quick-cert",
        title_he: "קורס קצר",
        title_en: "Quick Cert",
        description_he: "הכשרה קצרה",
        riasec_affinity: { R: 0.7, I: 0.3, A: 0.1, S: 0.4, E: 0.2, C: 0.3 },
        required_skills: [],
        desired_skills: [],
        values_fit: ["stability"],
        constraints: {
          typical_training_months: 2, // Too short for primary growth
          typical_training_cost_nis: 5000,
          requires_english_level: "basic",
          remote_ok: false,
          typical_locations: ["center"],
        },
        market: {
          demand_he: "high",
          typical_salary_nis_min: 7000,
          typical_salary_nis_max: 12000,
          ai_risk: "low",
        },
        data_source: "test",
        last_verified_at: "2026-05-01",
      },
      {
        id: "another-quick",
        title_he: "עוד קורס קצר",
        title_en: "Another Quick",
        description_he: "הכשרה קצרה נוספת",
        riasec_affinity: { R: 0.6, I: 0.4, A: 0.1, S: 0.3, E: 0.2, C: 0.3 },
        required_skills: [],
        desired_skills: [],
        values_fit: ["autonomy"],
        constraints: {
          typical_training_months: 1, // Too short for primary growth
          typical_training_cost_nis: 3000,
          requires_english_level: "none",
          remote_ok: false,
          typical_locations: ["center"],
        },
        market: {
          demand_he: "medium",
          typical_salary_nis_min: 6000,
          typical_salary_nis_max: 10000,
          ai_risk: "low",
        },
        data_source: "test",
        last_verified_at: "2026-05-01",
      },
    ];

    const rankings: Ranking[] = [
      {
        occupation_id: "quick-cert",
        total_score: 75,
        breakdown: {
          interests: null,
          skills: 80,
          values: null,
          big5: null,
          constraints: 85,
          market: 70,
        },
        weights_used: { skills: 40, constraints: 40, market: 20 },
      },
      {
        occupation_id: "another-quick",
        total_score: 68,
        breakdown: {
          interests: null,
          skills: 72,
          values: null,
          big5: null,
          constraints: 75,
          market: 65,
        },
        weights_used: { skills: 40, constraints: 40, market: 20 },
      },
    ];

    const paths = pickPaths(rankings, shortTrainingOccs);

    // Safe: quick-cert (constraints 85, training 2mo ≤12, high demand, total 75 ≥70)
    expect(paths.safe).toBe("quick-cert");
    
    // Growth: fallback guarantee assigns another-quick (total 68 ≥60, unused)
    // Primary growth criteria failed (training too short), but guarantee fills it
    expect(paths.growth).toBe("another-quick");
    
    // Wildcard: null (all candidates already used)
    expect(paths.wildcard).toBeNull();
  });

  it("production case: hvac safe, plumber/electrician fill growth+wildcard (all non-null)", () => {
    // Real production ranking from 2026-09-03: plumber(91), hvac(85), electrician(82), security-systems(82), auto-mechanic(79)
    // Safe should pick hvac, growth should pick plumber or electrician, wildcard the other — all three non-null
    const autoMechanic: Occupation = {
      id: "auto-mechanic",
      title_he: "מכונאי רכב",
      title_en: "Auto Mechanic",
      description_he: "מתקן רכבים",
      riasec_affinity: { R: 0.9, I: 0.4, A: 0.1, S: 0.3, E: 0.2, C: 0.3 },
      required_skills: [],
      desired_skills: [],
      values_fit: ["autonomy"],
      constraints: {
        typical_training_months: 18,
        typical_training_cost_nis: 30000,
        requires_english_level: "basic",
        remote_ok: false,
        typical_locations: ["center"],
      },
      market: {
        demand_he: "high",
        typical_salary_nis_min: 8000,
        typical_salary_nis_max: 16000,
        ai_risk: "low",
      },
      data_source: "test",
      last_verified_at: "2026-09-01",
    };
    const securitySystems: Occupation = {
      id: "security-systems",
      title_he: "טכנאי מערכות אבטחה",
      title_en: "Security Systems Tech",
      description_he: "מתקין מערכות אבטחה",
      riasec_affinity: { R: 0.8, I: 0.5, A: 0.1, S: 0.3, E: 0.2, C: 0.4 },
      required_skills: [],
      desired_skills: [],
      values_fit: ["stability"],
      constraints: {
        typical_training_months: 9,
        typical_training_cost_nis: 20000,
        requires_english_level: "basic",
        remote_ok: false,
        typical_locations: ["center"],
      },
      market: {
        demand_he: "high",
        typical_salary_nis_min: 9000,
        typical_salary_nis_max: 17000,
        ai_risk: "low",
      },
      data_source: "test",
      last_verified_at: "2026-09-01",
    };

    const rankings: Ranking[] = [
      {
        occupation_id: "plumber",
        total_score: 91,
        breakdown: {
          interests: null,
          skills: 87,
          values: null,
          big5: null,
          constraints: 92,
          market: 88,
        },
        weights_used: { skills: 40, constraints: 40, market: 20 },
      },
      {
        occupation_id: "hvac-tech",
        total_score: 85,
        breakdown: {
          interests: null,
          skills: 82,
          values: null,
          big5: null,
          constraints: 90,
          market: 83,
        },
        weights_used: { skills: 40, constraints: 40, market: 20 },
      },
      {
        occupation_id: "electrician",
        total_score: 82,
        breakdown: {
          interests: null,
          skills: 80,
          values: null,
          big5: null,
          constraints: 85,
          market: 80,
        },
        weights_used: { skills: 40, constraints: 40, market: 20 },
      },
      {
        occupation_id: "security-systems",
        total_score: 82,
        breakdown: {
          interests: null,
          skills: 79,
          values: null,
          big5: null,
          constraints: 86,
          market: 81,
        },
        weights_used: { skills: 40, constraints: 40, market: 20 },
      },
      {
        occupation_id: "auto-mechanic",
        total_score: 79,
        breakdown: {
          interests: null,
          skills: 76,
          values: null,
          big5: null,
          constraints: 83,
          market: 78,
        },
        weights_used: { skills: 40, constraints: 40, market: 20 },
      },
    ];

    const paths = pickPaths(rankings, [...mockOccupations, autoMechanic, securitySystems]);

    // Safe: hvac-tech (constraints 90≥70, training 6mo≤12, high demand, total 85≥70)
    expect(paths.safe).toBe("hvac-tech");
    
    // Growth: plumber (highest unused total_score 91≥60, training 9mo in 3-36, medium demand meets criteria)
    expect(paths.growth).toBe("plumber");
    
    // Wildcard: electrician (next highest unused total_score 82≥60)
    expect(paths.wildcard).toBe("electrician");
  });
});
