import { describe, it, expect } from "vitest";
import { scoreInterests } from "@/lib/matching/score/interests";
import type { MatchingProfile, Occupation } from "@/lib/matching/types";

const fakeOccupation = (riasec: Occupation["riasec_affinity"]): Occupation => ({
  id: "x", title_he: "x", title_en: "x", description_he: "x".repeat(40),
  riasec_affinity: riasec,
  required_skills: [], desired_skills: [], values_fit: [],
  constraints: {
    typical_training_months: 0, typical_training_cost_nis: 0,
    requires_english_level: "none", remote_ok: false, typical_locations: [],
  },
  market: { demand_he: "medium", typical_salary_nis_min: 0, typical_salary_nis_max: 0, ai_risk: "low" },
  data_source: "test", last_verified_at: "2026-01-01",
});

describe("scoreInterests", () => {
  it("returns null when profile has no RIASEC signal", () => {
    const profile: MatchingProfile = {
      interests: null, skills: null, values: null, big5: null, constraints: null,
    };
    const occ = fakeOccupation({ R: 1, I: 1, A: 1, S: 1, E: 1, C: 1 });
    expect(scoreInterests(profile, occ)).toBeNull();
  });

  it("returns 100 when user RIASEC perfectly aligns with occupation", () => {
    const profile: MatchingProfile = {
      interests: { R: 0, I: 100, A: 0, S: 0, E: 0, C: 0 },
      skills: null, values: null, big5: null, constraints: null,
    };
    const occ = fakeOccupation({ R: 0, I: 1, A: 0, S: 0, E: 0, C: 0 });
    expect(scoreInterests(profile, occ)).toBe(100);
  });

  it("returns 0 when user RIASEC is opposite to occupation", () => {
    const profile: MatchingProfile = {
      interests: { R: 100, I: 0, A: 0, S: 0, E: 0, C: 0 },
      skills: null, values: null, big5: null, constraints: null,
    };
    const occ = fakeOccupation({ R: 0, I: 1, A: 0, S: 0, E: 0, C: 0 });
    expect(scoreInterests(profile, occ)).toBe(0);
  });

  it("partial alignment returns mid-range", () => {
    const profile: MatchingProfile = {
      interests: { R: 50, I: 80, A: 30, S: 20, E: 10, C: 40 },
      skills: null, values: null, big5: null, constraints: null,
    };
    const occ = fakeOccupation({ R: 0.3, I: 0.85, A: 0.45, S: 0.3, E: 0.2, C: 0.55 });
    const score = scoreInterests(profile, occ);
    expect(score).toBeGreaterThan(50);
    expect(score).toBeLessThan(100);
  });
});
