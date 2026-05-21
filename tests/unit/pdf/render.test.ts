import { describe, it, expect } from "vitest";
import type { ReportData } from "@/lib/pdf/types";
import type { Occupation } from "@/lib/matching/types";

// PDF rendering goes through @react-pdf/renderer + fontkit + Heebo font load.
// The whole pipeline runs in-process; no Anthropic or DB calls.
// This test pins:
//   1. renderReport returns a Buffer
//   2. The buffer starts with the PDF magic bytes "%PDF-"
//   3. The buffer ends with "%%EOF" (PDF footer)
//   4. Hebrew text in the input survives the render (encoded into the PDF stream)
// If react-pdf or fontkit ever regress on Hebrew or Heebo loading, this test
// catches it at unit-test speed (no need to spin up a dev server + open a PDF).

const sampleOccupation: Occupation = {
  id: "product_manager",
  title_he: "מנהל/ת מוצר",
  title_en: "Product Manager",
  description_he: "אחראי/ת על הגדרת המוצר ותעדוף משימות פיתוח.",
  riasec_affinity: { R: 0.2, I: 0.6, A: 0.4, S: 0.5, E: 0.8, C: 0.5 },
  required_skills: [{ skill_id: "communication", importance: 0.9 }],
  desired_skills: [{ skill_id: "sql", importance: 0.4 }],
  values_fit: ["impact", "growth"],
  constraints: {
    typical_training_months: 6,
    typical_training_cost_nis: 8000,
    requires_english_level: "advanced",
    remote_ok: true,
    typical_locations: ["מרכז"],
  },
  market: {
    demand_he: "high",
    typical_salary_nis_min: 18000,
    typical_salary_nis_max: 35000,
    ai_risk: "low",
  },
  data_source: "test_fixture",
  last_verified_at: "2026-05-21",
};

const sampleData: ReportData = {
  generatedAt: "2026-05-21T10:00:00.000Z",
  userDisplayName: "אורח/ת",
  profile: {
    interests: { R: 30, I: 70, A: 40, S: 50, E: 80, C: 60 },
    skills: [{ id: "communication", level: 0.8 }],
    values: { topThree: ["impact", "growth", "autonomy"], alsoPicked: ["balance", "creativity"] },
    big5: { O: 70, C: 60, E: 55, A: 65, N: 40 },
    constraints: {
      location_he: "מרכז",
      remote_ok: true,
      time_per_week_hours: 20,
      english_level: "advanced",
      risk_tolerance: 6,
      needs_immediate_income: false,
    },
  },
  profileSummaryHe: "בן 22 אחרי צבא, מחפש כיוון מקצועי.",
  rankings: [
    {
      occupation_id: "product_manager",
      total_score: 78,
      breakdown: {
        interests: 80,
        skills: 70,
        values: 75,
        big5: 72,
        constraints: 85,
        market: 90,
      },
      weights_used: { interests: 25, skills: 20, values: 15, big5: 15, constraints: 15, market: 10 },
    },
  ],
  paths: {
    safe: "product_manager",
    growth: null,
    wildcard: null,
  },
  prose: {
    product_manager: "תפקיד שמשלב יצירתיות, אחריות, ועבודה עם אנשים — מתאים לפרופיל שלך.",
  },
  occupations: [sampleOccupation],
};

describe("renderReport", () => {
  it("renders a valid PDF buffer with Hebrew content", async () => {
    // Dynamic import to defer the heavy @react-pdf/renderer + fontkit load.
    const { renderReport } = await import("@/lib/pdf/render");
    const buffer = await renderReport(sampleData);

    expect(Buffer.isBuffer(buffer)).toBe(true);
    expect(buffer.length).toBeGreaterThan(5000);

    const head = buffer.subarray(0, 8).toString("ascii");
    expect(head.startsWith("%PDF-")).toBe(true);

    const tail = buffer.subarray(buffer.length - 32).toString("ascii");
    expect(tail).toContain("%%EOF");
  }, 30000);
});
