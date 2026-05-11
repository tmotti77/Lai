import { describe, it, expect } from "vitest";
import { scoreSkills } from "@/lib/matching/score/skills";
import type { MatchingProfile, Occupation } from "@/lib/matching/types";

const fakeOccupation = (req: Array<[string, number]>, des: Array<[string, number]> = []): Occupation => ({
  id: "x", title_he: "x", title_en: "x", description_he: "x".repeat(40),
  riasec_affinity: { R: 0, I: 0, A: 0, S: 0, E: 0, C: 0 },
  required_skills: req.map(([id, imp]) => ({ skill_id: id, importance: imp })),
  desired_skills: des.map(([id, imp]) => ({ skill_id: id, importance: imp })),
  values_fit: [],
  constraints: {
    typical_training_months: 0, typical_training_cost_nis: 0,
    requires_english_level: "none", remote_ok: false, typical_locations: [],
  },
  market: { demand_he: "medium", typical_salary_nis_min: 0, typical_salary_nis_max: 0, ai_risk: "low" },
  data_source: "test", last_verified_at: "2026-01-01",
});

describe("scoreSkills", () => {
  it("returns null when profile has no skills", () => {
    const profile: MatchingProfile = {
      interests: null, skills: null, values: null, big5: null, constraints: null,
    };
    const occ = fakeOccupation([["javascript", 1.0]]);
    expect(scoreSkills(profile, occ)).toBeNull();
  });

  it("returns 100 when user has all required skills at full level", () => {
    const profile: MatchingProfile = {
      interests: null, big5: null, values: null, constraints: null,
      skills: [
        { id: "javascript", level: 1.0 },
        { id: "sql", level: 1.0 },
      ],
    };
    const occ = fakeOccupation([["javascript", 1.0], ["sql", 0.5]]);
    expect(scoreSkills(profile, occ)).toBe(100);
  });

  it("returns 0 when user has none of the required skills", () => {
    const profile: MatchingProfile = {
      interests: null, big5: null, values: null, constraints: null,
      skills: [{ id: "cooking-technique", level: 1.0 }],
    };
    const occ = fakeOccupation([["javascript", 1.0]]);
    expect(scoreSkills(profile, occ)).toBe(0);
  });

  it("matches by Hebrew label fuzzy substring when ids don't match", () => {
    const profile: MatchingProfile = {
      interests: null, big5: null, values: null, constraints: null,
      skills: [{ id: "JavaScript / TypeScript", level: 1.0 }],
    };
    const occ = fakeOccupation([["javascript", 1.0]]);
    expect(scoreSkills(profile, occ)).toBeGreaterThanOrEqual(50);
  });

  it("desired skills contribute less than required skills", () => {
    const profileWithRequired: MatchingProfile = {
      interests: null, big5: null, values: null, constraints: null,
      skills: [{ id: "javascript", level: 1.0 }],
    };
    const profileWithDesired: MatchingProfile = {
      interests: null, big5: null, values: null, constraints: null,
      skills: [{ id: "react", level: 1.0 }],
    };
    const occ = fakeOccupation([["javascript", 1.0]], [["react", 1.0]]);
    expect(scoreSkills(profileWithRequired, occ))
      .toBeGreaterThan(scoreSkills(profileWithDesired, occ) ?? 0);
  });
});
