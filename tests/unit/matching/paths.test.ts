import { describe, it, expect } from "vitest";
import { pickPaths } from "@/lib/matching/paths";
import type { Ranking, Occupation } from "@/lib/matching/types";

const fakeOcc = (overrides: Partial<Occupation> & { id: string }): Occupation => ({
  title_he: overrides.id, title_en: overrides.id, description_he: "x".repeat(40),
  riasec_affinity: { R: 0.5, I: 0.5, A: 0.5, S: 0.5, E: 0.5, C: 0.5 },
  required_skills: [], desired_skills: [], values_fit: [],
  constraints: {
    typical_training_months: 6, typical_training_cost_nis: 0,
    requires_english_level: "none", remote_ok: false, typical_locations: [],
  },
  market: { demand_he: "high", typical_salary_nis_min: 0, typical_salary_nis_max: 0, ai_risk: "low" },
  data_source: "test", last_verified_at: "2026-01-01",
  // Spread LAST so callers can override any field. Previously title_he was hard-wired to
  // overrides.id, so a test passing a Hebrew title silently got the Latin id instead — which
  // hid a title-regex bug in pickPaths from the entire suite.
  ...overrides,
});

const rank = (id: string, total: number, breakdown: Partial<Ranking["breakdown"]>): Ranking => ({
  occupation_id: id,
  total_score: total,
  breakdown: { interests: null, skills: null, values: null, big5: null, constraints: null, market: null, ...breakdown },
  weights_used: {},
});

describe("pickPaths", () => {
  it("picks safe = highest with constraints>=70 + training<=12mo + high demand", () => {
    const occs = [
      fakeOcc({ id: "long-train", constraints: { typical_training_months: 24, typical_training_cost_nis: 0, requires_english_level: "none", remote_ok: false, typical_locations: [] } }),
      fakeOcc({ id: "short-train", constraints: { typical_training_months: 9, typical_training_cost_nis: 0, requires_english_level: "none", remote_ok: false, typical_locations: [] } }),
    ];
    const rankings = [
      rank("long-train", 80, { constraints: 90, interests: 70 }),
      rank("short-train", 70, { constraints: 75, interests: 70 }),
    ];
    const paths = pickPaths(rankings, occs);
    expect(paths.safe).toBe("short-train");
  });

  it("picks growth = next-best with interests>=65 and 6-24 month training", () => {
    const occs = [
      fakeOcc({ id: "safe-pick", constraints: { typical_training_months: 9, typical_training_cost_nis: 0, requires_english_level: "none", remote_ok: false, typical_locations: [] } }),
      fakeOcc({ id: "growth-pick", constraints: { typical_training_months: 18, typical_training_cost_nis: 0, requires_english_level: "none", remote_ok: false, typical_locations: [] } }),
      fakeOcc({ id: "too-long", constraints: { typical_training_months: 36, typical_training_cost_nis: 0, requires_english_level: "none", remote_ok: false, typical_locations: [] } }),
    ];
    const rankings = [
      rank("safe-pick", 90, { constraints: 85, interests: 80 }),
      rank("growth-pick", 80, { constraints: 60, interests: 75 }),
      rank("too-long", 75, { constraints: 60, interests: 80 }),
    ];
    const paths = pickPaths(rankings, occs);
    expect(paths.safe).toBe("safe-pick");
    expect(paths.growth).toBe("growth-pick");
  });

  it("fills at least one path even with low-quality occupations (updated expectation)", () => {
    const occs = [fakeOcc({ id: "x", constraints: { typical_training_months: 36, typical_training_cost_nis: 0, requires_english_level: "none", remote_ok: false, typical_locations: [] }, market: { demand_he: "low", typical_salary_nis_min: 0, typical_salary_nis_max: 0, ai_risk: "low" } })];
    const rankings = [rank("x", 40, { interests: 30, constraints: 30 })];
    const paths = pickPaths(rankings, occs);
    // With the no-floor fallback, even a single low-quality occupation fills safe
    expect(paths.safe).toBe("x");
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

  it("fills all paths even when all scores are below 60 (regression for production bug 2026-09-17)", () => {
    const occs = [
      fakeOcc({ id: "paramedic", title_he: "פרמדיק", constraints: { typical_training_months: 24, typical_training_cost_nis: 0, requires_english_level: "none", remote_ok: false, typical_locations: [] }, market: { demand_he: "medium", typical_salary_nis_min: 0, typical_salary_nis_max: 0, ai_risk: "low" } }),
      fakeOcc({ id: "plumber", title_he: "אינסטלטור", constraints: { typical_training_months: 18, typical_training_cost_nis: 0, requires_english_level: "none", remote_ok: false, typical_locations: [] }, market: { demand_he: "high", typical_salary_nis_min: 0, typical_salary_nis_max: 0, ai_risk: "low" } }),
      fakeOcc({ id: "hvac", title_he: "טכנאי מיזוג אוויר", constraints: { typical_training_months: 12, typical_training_cost_nis: 0, requires_english_level: "none", remote_ok: false, typical_locations: [] }, market: { demand_he: "high", typical_salary_nis_min: 0, typical_salary_nis_max: 0, ai_risk: "low" } }),
      fakeOcc({ id: "electrician", title_he: "חשמלאי", constraints: { typical_training_months: 24, typical_training_cost_nis: 0, requires_english_level: "none", remote_ok: false, typical_locations: [] }, market: { demand_he: "medium", typical_salary_nis_min: 0, typical_salary_nis_max: 0, ai_risk: "low" } }),
      fakeOcc({ id: "carpenter", title_he: "נגר", constraints: { typical_training_months: 18, typical_training_cost_nis: 0, requires_english_level: "none", remote_ok: false, typical_locations: [] }, market: { demand_he: "medium", typical_salary_nis_min: 0, typical_salary_nis_max: 0, ai_risk: "low" } }),
    ];
    const rankings = [
      rank("paramedic", 58, { interests: 55, constraints: 60 }),
      rank("plumber", 56, { interests: 50, constraints: 58 }),
      rank("hvac", 52, { interests: 48, constraints: 55 }),
      rank("electrician", 49, { interests: 45, constraints: 50 }),
      rank("carpenter", 41, { interests: 38, constraints: 42 }),
    ];
    const paths = pickPaths(rankings, occs);
    
    // All three paths should be filled with distinct occupations
    expect(paths.safe).not.toBeNull();
    expect(paths.growth).not.toBeNull();
    expect(paths.wildcard).not.toBeNull();
    
    // All three should be distinct
    const pathIds = [paths.safe, paths.growth, paths.wildcard];
    const uniqueIds = new Set(pathIds);
    expect(uniqueIds.size).toBe(3);
    
    // Should prefer hands-on trades (all these are trades, so just verify non-null)
    expect(pathIds).toContain("paramedic");
    expect(pathIds).toContain("plumber");
    expect(pathIds).toContain("hvac");
  });
  it("fallback preserves ranking order and ignores job titles (regression: title regex demoted top matches)", () => {
    // Real catalog titles from the 2026-09-17 production case. A title-regex fallback
    // returned hvac(52)/electrician(49) and skipped paramedic(58)/plumber(56) because
    // their Hebrew titles did not match the "hands-on trade" pattern. Ranking order wins.
    const occs = [
      fakeOcc({ id: "paramedic", title_he: "פאראמדיק/ית" }),
      fakeOcc({ id: "plumber", title_he: "אינסטלטור/ית" }),
      fakeOcc({ id: "hvac", title_he: "טכנאי/ת מיזוג אוויר" }),
      fakeOcc({ id: "electrician", title_he: "חשמלאי/ת מוסמך/ת" }),
    ];
    const rankings = [
      rank("paramedic", 58, { skills: 45, market: 85 }),
      rank("plumber", 56, { skills: 41, market: 85 }),
      rank("hvac", 52, { skills: 35, market: 85 }),
      rank("electrician", 49, { skills: 31, market: 85 }),
    ];
    const paths = pickPaths(rankings, occs);
    expect(paths.safe).toBe("paramedic");
    expect(paths.growth).toBe("plumber");
    expect(paths.wildcard).toBe("hvac");
  });

  it("fakeOcc honours a title_he override (guards the helper itself)", () => {
    expect(fakeOcc({ id: "x", title_he: "פאראמדיק" }).title_he).toBe("פאראמדיק");
    expect(fakeOcc({ id: "x" }).title_he).toBe("x");
  });
});
