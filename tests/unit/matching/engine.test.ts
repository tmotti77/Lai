import { describe, it, expect } from "vitest";
import { rankOccupations } from "@/lib/matching/engine";
import type { MatchingProfile, Occupation } from "@/lib/matching/types";

const fakeOcc = (id: string, riasecI: number, demand: Occupation["market"]["demand_he"] = "high"): Occupation => ({
  id, title_he: id, title_en: id, description_he: "x".repeat(40),
  riasec_affinity: { R: 0, I: riasecI, A: 0, S: 0, E: 0, C: 0 },
  required_skills: [], desired_skills: [], values_fit: [],
  constraints: {
    typical_training_months: 6, typical_training_cost_nis: 10000,
    requires_english_level: "intermediate", remote_ok: true, typical_locations: ["מרכז"],
  },
  market: { demand_he: demand, typical_salary_nis_min: 10000, typical_salary_nis_max: 20000, ai_risk: "low" },
  data_source: "test", last_verified_at: "2026-01-01",
});

const fakeOccWithVec = (
  id: string,
  riasec: Occupation["riasec_affinity"],
  demand: Occupation["market"]["demand_he"] = "high",
): Occupation => ({
  ...fakeOcc(id, 0, demand),
  riasec_affinity: riasec,
});

describe("rankOccupations", () => {
  it("ranks by total score descending", () => {
    // Cosine similarity is magnitude-invariant on a single axis. To make the
    // ranking discriminate, the three occupations differ on multiple axes so
    // their RIASEC vectors are not colinear with the profile's I-only signal.
    const profile: MatchingProfile = {
      interests: { R: 0, I: 100, A: 0, S: 0, E: 0, C: 0 },
      skills: null, values: null, big5: null, constraints: null,
    };
    const occs = [
      fakeOccWithVec("low-i",  { R: 0.8, I: 0.2, A: 0, S: 0, E: 0, C: 0 }),
      fakeOccWithVec("high-i", { R: 0,   I: 1.0, A: 0, S: 0, E: 0, C: 0 }),
      fakeOccWithVec("mid-i",  { R: 0.4, I: 0.6, A: 0, S: 0, E: 0, C: 0 }),
    ];
    const result = rankOccupations(profile, occs);
    expect(result.map((r) => r.occupation_id)).toEqual(["high-i", "mid-i", "low-i"]);
  });

  it("re-normalizes weights when dimensions are missing", () => {
    const profile: MatchingProfile = {
      interests: { R: 0, I: 100, A: 0, S: 0, E: 0, C: 0 },
      skills: null, values: null, big5: null, constraints: null,
    };
    const occ = fakeOcc("only-i", 1.0);
    const result = rankOccupations(profile, [occ]);
    const r = result[0];
    // Only interests + market are scoreable. Weights re-normalize from 25 + 10 = 35 → 100.
    // interests is 25/35 ≈ 71.4%; market is 10/35 ≈ 28.6%.
    const interestsW = r.weights_used.interests!;
    const marketW = r.weights_used.market!;
    expect(interestsW + marketW).toBeCloseTo(100, 0);
    expect(interestsW).toBeGreaterThan(70);
    expect(interestsW).toBeLessThan(72);
  });

  it("breakdown carries null for missing dimensions", () => {
    const profile: MatchingProfile = {
      interests: { R: 0, I: 100, A: 0, S: 0, E: 0, C: 0 },
      skills: null, values: null, big5: null, constraints: null,
    };
    const result = rankOccupations(profile, [fakeOcc("a", 0.5)]);
    expect(result[0].breakdown.interests).not.toBeNull();
    expect(result[0].breakdown.skills).toBeNull();
    expect(result[0].breakdown.values).toBeNull();
    expect(result[0].breakdown.big5).toBeNull();
    expect(result[0].breakdown.constraints).toBeNull();
    expect(result[0].breakdown.market).not.toBeNull();
  });

  it("returns empty array on empty occupations input", () => {
    const profile: MatchingProfile = {
      interests: { R: 0, I: 100, A: 0, S: 0, E: 0, C: 0 },
      skills: null, values: null, big5: null, constraints: null,
    };
    expect(rankOccupations(profile, [])).toEqual([]);
  });

  it("market alone produces a score even with empty profile", () => {
    const profile: MatchingProfile = {
      interests: null, skills: null, values: null, big5: null, constraints: null,
    };
    const result = rankOccupations(profile, [fakeOcc("a", 0.5, "very_high")]);
    expect(result[0].total_score).toBe(100);
    expect(result[0].weights_used.market).toBe(100);
  });
});
