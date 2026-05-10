import { describe, it, expect } from "vitest";
import { scoreBig5 } from "@/lib/matching/score/big5";
import type { MatchingProfile, Occupation, Big5Vector } from "@/lib/matching/types";

const occ = (big5_fit?: Partial<Big5Vector>): Occupation => ({
  id: "x", title_he: "x", title_en: "x", description_he: "x".repeat(40),
  riasec_affinity: { R: 0, I: 0, A: 0, S: 0, E: 0, C: 0 },
  required_skills: [], desired_skills: [], values_fit: [],
  big5_fit,
  constraints: {
    typical_training_months: 0, typical_training_cost_nis: 0,
    requires_english_level: "none", remote_ok: false, typical_locations: [],
  },
  market: { demand_he: "medium", typical_salary_nis_min: 0, typical_salary_nis_max: 0, ai_risk: "low" },
  data_source: "test", last_verified_at: "2026-01-01",
});

describe("scoreBig5", () => {
  it("returns null when no big5 signal", () => {
    const profile: MatchingProfile = { interests: null, skills: null, big5: null, constraints: null, values: null };
    expect(scoreBig5(profile, occ({ O: 70 }))).toBeNull();
  });

  it("returns 100 when occupation has no big5_fit (no preference = perfect fit)", () => {
    const profile: MatchingProfile = {
      interests: null, skills: null, values: null, constraints: null,
      big5: { O: 50, C: 50, E: 50, A: 50, N: 50 },
    };
    expect(scoreBig5(profile, occ(undefined))).toBe(100);
  });

  it("returns 100 when user trait exactly matches occupation preference", () => {
    const profile: MatchingProfile = {
      interests: null, skills: null, values: null, constraints: null,
      big5: { O: 70, C: 50, E: 50, A: 50, N: 50 },
    };
    expect(scoreBig5(profile, occ({ O: 70 }))).toBe(100);
  });

  it("returns lower score when user trait is far from preference", () => {
    const profile: MatchingProfile = {
      interests: null, skills: null, values: null, constraints: null,
      big5: { O: 10, C: 50, E: 50, A: 50, N: 50 },
    };
    expect(scoreBig5(profile, occ({ O: 90 }))).toBeLessThan(50);
  });

  it("averages across multiple trait preferences", () => {
    const profile: MatchingProfile = {
      interests: null, skills: null, values: null, constraints: null,
      big5: { O: 70, C: 70, E: 50, A: 50, N: 50 },
    };
    const single = scoreBig5(profile, occ({ O: 70 }));
    const both = scoreBig5(profile, occ({ O: 70, C: 70 }));
    expect(single).toBe(100);
    expect(both).toBe(100);
  });
});
