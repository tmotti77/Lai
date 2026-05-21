import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { rankOccupations } from "@/lib/matching/engine";
import { pickPaths } from "@/lib/matching/paths";
import type { MatchingProfile, Occupation } from "@/lib/matching/types";

// Sanity test that exercises the REAL catalog (content/occupations/*.json) —
// catches catalog drift where adding a new occupation or changing a skill
// weight produces nonsense matches for archetypal profiles.

const OCC_DIR = join(process.cwd(), "content", "occupations");
const ALL_OCCS: Occupation[] = readdirSync(OCC_DIR)
  .filter((f) => f.endsWith(".json") && !f.startsWith("_"))
  .map((f) => JSON.parse(readFileSync(join(OCC_DIR, f), "utf8")) as Occupation);

function topNIds(profile: MatchingProfile, n: number): string[] {
  return rankOccupations(profile, ALL_OCCS)
    .slice(0, n)
    .map((r) => r.occupation_id);
}

describe("matching engine sanity — real catalog", () => {
  it("loads 50+ occupations from the catalog", () => {
    expect(ALL_OCCS.length).toBeGreaterThanOrEqual(50);
  });

  it("Investigative + Enterprising profile → tech/product roles dominate top 5", () => {
    // Mirrors the demo seed profile: analytical Israeli post-army, high English
    const profile: MatchingProfile = {
      interests: { R: 50, I: 100, A: 50, S: 75, E: 75, C: 50 },
      skills: [
        { id: "communication", level: 0.85 },
        { id: "data-analysis", level: 0.8 },
        { id: "problem-solving", level: 0.9 },
        { id: "english", level: 0.85 },
      ],
      values: { topThree: ["impact", "learning", "challenge"], alsoPicked: ["balance", "creativity"] },
      big5: { O: 100, C: 75, E: 75, A: 75, N: 25 },
      constraints: {
        location_he: "מרכז",
        remote_ok: true,
        time_per_week_hours: 20,
        training_budget_nis: 8000,
        english_level: "advanced",
        risk_tolerance: 6,
        needs_immediate_income: false,
      },
    };
    const top5 = topNIds(profile, 5);
    // At least 3 of top 5 must be from this set of investigative+enterprising fits
    const goodMatches = new Set([
      "business-analyst", "data-scientist", "product-manager", "product-designer",
      "ml-engineer", "security-engineer", "ux-designer", "customer-success-manager",
      "scrum-master", "data-analyst", "seo-specialist",
    ]);
    const matches = top5.filter((id) => goodMatches.has(id));
    expect(matches.length).toBeGreaterThanOrEqual(3);
    // Definitely NOT in top 5: pure trades, allied health that requires 4-year degree on low budget
    const badMatches = new Set(["plumber", "electrician", "physiotherapist", "nurse", "chef"]);
    const bad = top5.filter((id) => badMatches.has(id));
    expect(bad.length).toBe(0);
  });

  it("Realistic-dominant profile (hands-on, no English) → trades or technicians in top 5", () => {
    const profile: MatchingProfile = {
      interests: { R: 100, I: 50, A: 25, S: 50, E: 25, C: 50 },
      skills: [
        { id: "tool-use", level: 0.9 },
        { id: "manual-dexterity", level: 0.85 },
      ],
      values: { topThree: ["money", "freedom", "stability"], alsoPicked: ["variety", "team"] },
      big5: null,
      constraints: {
        location_he: "צפון",
        remote_ok: false,
        time_per_week_hours: 40,
        training_budget_nis: 15000,
        english_level: "basic",
        risk_tolerance: 5,
        needs_immediate_income: true,
        months_until_income_required: 12,
      },
    };
    const top5 = topNIds(profile, 5);
    const handsOn = new Set([
      "electrician", "plumber", "auto-mechanic", "chef", "lab-technician",
      "industrial-engineer", "paramedic",
    ]);
    const matches = top5.filter((id) => handsOn.has(id));
    expect(matches.length).toBeGreaterThanOrEqual(2);
    // High-English roles should NOT dominate
    const englishHeavy = new Set(["data-scientist", "ml-engineer", "technical-writer", "sdr-business-development"]);
    const eng = top5.filter((id) => englishHeavy.has(id));
    expect(eng.length).toBeLessThanOrEqual(1);
  });

  it("Social + Agreeable profile → allied health / education / counseling in top 5", () => {
    const profile: MatchingProfile = {
      interests: { R: 25, I: 50, A: 50, S: 100, E: 25, C: 25 },
      skills: [
        { id: "empathy", level: 0.95 },
        { id: "communication", level: 0.9 },
        { id: "patience", level: 0.85 },
      ],
      values: { topThree: ["impact", "service", "team"], alsoPicked: ["stability", "balance"] },
      big5: { O: 60, C: 70, E: 60, A: 95, N: 30 },
      constraints: {
        location_he: "ירושלים",
        remote_ok: false,
        time_per_week_hours: 40,
        training_budget_nis: 60000,
        english_level: "intermediate",
        risk_tolerance: 4,
        needs_immediate_income: false,
      },
    };
    const top5 = topNIds(profile, 5);
    const social = new Set([
      "social-worker", "nurse", "elementary-teacher", "special-ed-teacher",
      "physiotherapist", "occupational-therapist", "speech-therapist",
      "dietitian", "customer-success-manager", "hr-recruiter",
    ]);
    const matches = top5.filter((id) => social.has(id));
    expect(matches.length).toBeGreaterThanOrEqual(3);
    // Cold tech-only roles should not dominate this profile
    const techOnly = new Set(["devops-engineer", "qa-automation", "backend-developer"]);
    const tech = top5.filter((id) => techOnly.has(id));
    expect(tech.length).toBeLessThanOrEqual(1);
  });

  it("Artistic + high-O profile → creative roles in top 5", () => {
    const profile: MatchingProfile = {
      interests: { R: 25, I: 50, A: 100, S: 50, E: 25, C: 25 },
      skills: [
        { id: "creativity", level: 0.95 },
        { id: "writing-he", level: 0.85 },
      ],
      values: { topThree: ["creativity", "freedom", "variety"], alsoPicked: ["balance", "learning"] },
      big5: { O: 95, C: 50, E: 60, A: 65, N: 40 },
      constraints: {
        location_he: "תל אביב",
        remote_ok: true,
        time_per_week_hours: 25,
        training_budget_nis: 12000,
        english_level: "intermediate",
        risk_tolerance: 7,
        needs_immediate_income: false,
      },
    };
    const top5 = topNIds(profile, 5);
    const creative = new Set([
      "graphic-designer", "ux-designer", "product-designer", "copywriter",
      "content-writer", "video-editor", "social-media-manager", "journalist",
    ]);
    const matches = top5.filter((id) => creative.has(id));
    expect(matches.length).toBeGreaterThanOrEqual(3);
  });

  it("Conventional + high-C profile (admin/finance) → spreadsheet roles in top 5", () => {
    const profile: MatchingProfile = {
      interests: { R: 25, I: 50, A: 25, S: 25, E: 50, C: 100 },
      skills: [
        { id: "spreadsheets", level: 0.9 },
        { id: "attention-to-detail", level: 0.95 },
      ],
      values: { topThree: ["stability", "money", "balance"], alsoPicked: ["status", "team"] },
      big5: { O: 50, C: 95, E: 50, A: 65, N: 30 },
      constraints: {
        location_he: "מרכז",
        remote_ok: true,
        time_per_week_hours: 40,
        training_budget_nis: 30000,
        english_level: "intermediate",
        risk_tolerance: 3,
        needs_immediate_income: true,
        months_until_income_required: 6,
      },
    };
    const top5 = topNIds(profile, 5);
    const admin = new Set([
      "accountant", "bookkeeper", "business-analyst", "financial-analyst",
      "operations-manager", "industrial-engineer", "paralegal",
    ]);
    const matches = top5.filter((id) => admin.has(id));
    expect(matches.length).toBeGreaterThanOrEqual(3);
  });

  it("pickPaths produces 3 unique occupations or nulls (never duplicates)", () => {
    const profile: MatchingProfile = {
      interests: { R: 50, I: 100, A: 50, S: 75, E: 75, C: 50 },
      skills: null, values: null, big5: null,
      constraints: {
        location_he: "מרכז", remote_ok: true,
        time_per_week_hours: 20, training_budget_nis: 8000,
        english_level: "advanced", risk_tolerance: 6, needs_immediate_income: false,
      },
    };
    const rankings = rankOccupations(profile, ALL_OCCS);
    const paths = pickPaths(rankings, ALL_OCCS);
    const ids = [paths.safe, paths.growth, paths.wildcard].filter(Boolean) as string[];
    const unique = new Set(ids);
    expect(unique.size).toBe(ids.length);
  });

  it("re-normalizes when a profile dimension is null (chat-only user)", () => {
    // Chat-only: only interests + values + constraints. No formal Big5 or skills.
    const profile: MatchingProfile = {
      interests: { R: 50, I: 100, A: 50, S: 75, E: 75, C: 50 },
      skills: null,
      values: { topThree: ["impact", "learning", "challenge"], alsoPicked: [] },
      big5: null,
      constraints: {
        location_he: "מרכז", remote_ok: true,
        time_per_week_hours: 20, training_budget_nis: 8000,
        english_level: "advanced", risk_tolerance: 6, needs_immediate_income: false,
      },
    };
    const rankings = rankOccupations(profile, ALL_OCCS);
    const top = rankings[0];
    // Sum of used weights should = 100 even with missing dimensions
    const totalWeight = Object.values(top.weights_used).reduce((a, b) => a + b, 0);
    expect(Math.round(totalWeight)).toBe(100);
    // The dimension count tracker should report 4 (interests, values, constraints, market)
    expect(Object.keys(top.weights_used).length).toBe(4);
  });
});
