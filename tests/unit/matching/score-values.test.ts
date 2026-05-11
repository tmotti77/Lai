import { describe, it, expect } from "vitest";
import { scoreValues } from "@/lib/matching/score/values";
import type { MatchingProfile, Occupation } from "@/lib/matching/types";

const occ = (values_fit: string[]): Occupation => ({
  id: "x", title_he: "x", title_en: "x", description_he: "x".repeat(40),
  riasec_affinity: { R: 0, I: 0, A: 0, S: 0, E: 0, C: 0 },
  required_skills: [], desired_skills: [],
  values_fit,
  constraints: {
    typical_training_months: 0, typical_training_cost_nis: 0,
    requires_english_level: "none", remote_ok: false, typical_locations: [],
  },
  market: { demand_he: "medium", typical_salary_nis_min: 0, typical_salary_nis_max: 0, ai_risk: "low" },
  data_source: "test", last_verified_at: "2026-01-01",
});

describe("scoreValues", () => {
  it("returns null when no values signal", () => {
    const profile: MatchingProfile = { interests: null, skills: null, big5: null, constraints: null, values: null };
    expect(scoreValues(profile, occ(["money"]))).toBeNull();
  });

  it("returns 100 when occupation fits all 3 ranked values", () => {
    const profile: MatchingProfile = {
      interests: null, skills: null, big5: null, constraints: null,
      values: { topThree: ["money", "freedom", "learning"], alsoPicked: ["challenge", "balance"] },
    };
    expect(scoreValues(profile, occ(["money", "freedom", "learning", "team", "balance"]))).toBe(100);
  });

  it("rank position weights matter — top1 worth more than top3", () => {
    const profile: MatchingProfile = {
      interests: null, skills: null, big5: null, constraints: null,
      values: { topThree: ["money", "freedom", "learning"], alsoPicked: [] },
    };
    const fitsTop1 = occ(["money"]);
    const fitsTop3 = occ(["learning"]);
    expect(scoreValues(profile, fitsTop1)).toBeGreaterThan(scoreValues(profile, fitsTop3) ?? 0);
  });

  it("alsoPicked counts but less than ranked", () => {
    const profile: MatchingProfile = {
      interests: null, skills: null, big5: null, constraints: null,
      values: { topThree: ["money", "freedom", "learning"], alsoPicked: ["challenge"] },
    };
    const onlyAlso = occ(["challenge"]);
    const onlyTop3 = occ(["learning"]);
    expect(scoreValues(profile, onlyTop3)).toBeGreaterThan(scoreValues(profile, onlyAlso) ?? 0);
  });

  it("returns 0 when no overlap", () => {
    const profile: MatchingProfile = {
      interests: null, skills: null, big5: null, constraints: null,
      values: { topThree: ["money", "freedom", "learning"], alsoPicked: [] },
    };
    expect(scoreValues(profile, occ(["service", "team", "stability"]))).toBe(0);
  });
});
