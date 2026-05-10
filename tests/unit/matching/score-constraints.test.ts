import { describe, it, expect } from "vitest";
import { scoreConstraints } from "@/lib/matching/score/constraints";
import type { MatchingProfile, Occupation } from "@/lib/matching/types";

const occ = (overrides: Partial<Occupation["constraints"]> = {}, market_overrides: Partial<Occupation["market"]> = {}): Occupation => ({
  id: "x", title_he: "x", title_en: "x", description_he: "x".repeat(40),
  riasec_affinity: { R: 0, I: 0, A: 0, S: 0, E: 0, C: 0 },
  required_skills: [], desired_skills: [], values_fit: [],
  constraints: {
    typical_training_months: 12,
    typical_training_cost_nis: 30000,
    requires_english_level: "intermediate",
    remote_ok: true,
    typical_locations: ["מרכז"],
    ...overrides,
  },
  market: {
    demand_he: "high",
    typical_salary_nis_min: 10000,
    typical_salary_nis_max: 20000,
    ai_risk: "low",
    ...market_overrides,
  },
  data_source: "test", last_verified_at: "2026-01-01",
});

describe("scoreConstraints", () => {
  it("returns null when no constraints signal", () => {
    const profile: MatchingProfile = { interests: null, skills: null, big5: null, values: null, constraints: null };
    expect(scoreConstraints(profile, occ())).toBeNull();
  });

  it("returns 100 when all user constraints fit comfortably", () => {
    const profile: MatchingProfile = {
      interests: null, skills: null, big5: null, values: null,
      constraints: {
        location_he: "מרכז", remote_ok: false,
        time_per_week_hours: 20, training_budget_nis: 50000,
        english_level: "advanced",
      },
    };
    expect(scoreConstraints(profile, occ())).toBe(100);
  });

  it("penalizes when training cost exceeds budget", () => {
    const profile: MatchingProfile = {
      interests: null, skills: null, big5: null, values: null,
      constraints: {
        location_he: "מרכז", training_budget_nis: 5000,
        time_per_week_hours: 20, english_level: "advanced",
      },
    };
    expect(scoreConstraints(profile, occ({ typical_training_cost_nis: 50000 }))).toBeLessThan(70);
  });

  it("penalizes when location doesn't match and not remote-ok", () => {
    const profile: MatchingProfile = {
      interests: null, skills: null, big5: null, values: null,
      constraints: {
        location_he: "צפון", remote_ok: false,
        time_per_week_hours: 20, training_budget_nis: 50000,
        english_level: "advanced",
      },
    };
    expect(scoreConstraints(profile, occ({ typical_locations: ["מרכז"], remote_ok: false }))).toBeLessThan(70);
  });

  it("rewards remote when both user and occupation accept it", () => {
    const profile: MatchingProfile = {
      interests: null, skills: null, big5: null, values: null,
      constraints: {
        location_he: "צפון", remote_ok: true,
        time_per_week_hours: 20, training_budget_nis: 50000,
        english_level: "advanced",
      },
    };
    expect(scoreConstraints(profile, occ({ typical_locations: ["מרכז"], remote_ok: true }))).toBeGreaterThanOrEqual(80);
  });

  it("penalizes when occupation requires higher english than user has", () => {
    const profile: MatchingProfile = {
      interests: null, skills: null, big5: null, values: null,
      constraints: {
        location_he: "מרכז", training_budget_nis: 50000,
        time_per_week_hours: 20, english_level: "basic",
      },
    };
    expect(scoreConstraints(profile, occ({ requires_english_level: "fluent" }))).toBeLessThan(70);
  });

  it("penalizes when training months exceed user's months_until_income_required", () => {
    const profile: MatchingProfile = {
      interests: null, skills: null, big5: null, values: null,
      constraints: {
        location_he: "מרכז", training_budget_nis: 50000,
        time_per_week_hours: 20, english_level: "advanced",
        needs_immediate_income: true, months_until_income_required: 3,
      },
    };
    expect(scoreConstraints(profile, occ({ typical_training_months: 12 }))).toBeLessThan(50);
  });
});
