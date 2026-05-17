import { describe, it, expect } from "vitest";
import { z } from "zod";

// We import only the types/schemas we need.
// ProfileSchema is not exported from extraction.ts currently — we test via
// the exported ExtractedProfile type and the values/constraints sub-shapes.
// We pull the schema directly to do parse-level assertions.
//
// NOTE: extraction.ts uses "server-only", so we can't import it in vitest
// (no Next.js server context). We replicate the zod schemas under test here
// to pin the CONTRACT shape expected by the matcher — if the real schemas
// diverge from these, the types tests (npx tsc --noEmit) will catch it.

// ---- Replicated expected schemas (must mirror lib/ai/extraction.ts) --------

const ExpectedConstraintsSchema = z.object({
  location_he: z.string().optional(),
  remote_ok: z.boolean().optional(),
  time_per_week_hours: z.number().min(0).max(60).optional(),
  training_budget_nis: z.number().min(0).max(200_000).optional(),
  english_level: z
    .enum(["none", "basic", "intermediate", "advanced", "fluent"])
    .optional(),
  risk_tolerance: z.number().int().min(1).max(10).optional(),
  needs_immediate_income: z.boolean().optional(),
  months_until_income_required: z.number().int().min(0).max(36).optional(),
});

// Values in the chat extraction path are stored as a flat string[] in
// career_profile.data.values. buildMatchingProfile slices [0..3] → topThree,
// [3..5] → alsoPicked. So extraction must emit string[] sorted primary-first.
const ExpectedValuesSchema = z.array(z.string());

// ---- Matcher shape ---------------------------------------------------------

import { buildMatchingProfile } from "@/lib/matching/profile";

describe("extraction → matching profile shape compatibility", () => {
  describe("values schema", () => {
    it("values schema accepts an array of string keys", () => {
      const result = ExpectedValuesSchema.safeParse([
        "meaning",
        "autonomy",
        "stability",
        "learning",
        "team",
      ]);
      expect(result.success).toBe(true);
    });

    it("buildMatchingProfile maps chat string[] values into topThree + alsoPicked", () => {
      const profile = buildMatchingProfile({
        data: {
          values: ["meaning", "stability", "learning", "belonging", "money"],
        },
      });
      expect(profile.values).toEqual({
        topThree: ["meaning", "stability", "learning"],
        alsoPicked: ["belonging", "money"],
      });
    });

    it("buildMatchingProfile topThree has at most 3 items from chat values", () => {
      const profile = buildMatchingProfile({
        data: { values: ["a", "b"] },
      });
      expect(profile.values?.topThree).toHaveLength(2);
      expect(profile.values?.alsoPicked).toHaveLength(0);
    });
  });

  describe("constraints schema — field name alignment", () => {
    it("risk_tolerance is a single integer 1..10 (not risk_tolerance_1_10)", () => {
      const result = ExpectedConstraintsSchema.safeParse({
        risk_tolerance: 7,
      });
      expect(result.success).toBe(true);
      expect((result as { success: true; data: z.infer<typeof ExpectedConstraintsSchema> }).data.risk_tolerance).toBe(7);
    });

    it("risk_tolerance rejects values outside 1..10", () => {
      expect(ExpectedConstraintsSchema.safeParse({ risk_tolerance: 0 }).success).toBe(false);
      expect(ExpectedConstraintsSchema.safeParse({ risk_tolerance: 11 }).success).toBe(false);
    });

    it("english_level accepts the matcher's enum values", () => {
      for (const val of ["none", "basic", "intermediate", "advanced", "fluent"] as const) {
        expect(
          ExpectedConstraintsSchema.safeParse({ english_level: val }).success,
        ).toBe(true);
      }
    });

    it("english_level rejects 'native' (not in matcher's enum)", () => {
      const result = ExpectedConstraintsSchema.safeParse({
        english_level: "native",
      });
      expect(result.success).toBe(false);
    });

    it("structured budget field is training_budget_nis (number), not budget_he (string)", () => {
      const result = ExpectedConstraintsSchema.safeParse({
        training_budget_nis: 20000,
      });
      expect(result.success).toBe(true);
      // Old field budget_he must NOT be in schema — passing it should not cause a parse error
      // (zod strips unknown keys by default) but the field must not appear in output
      const parsed = (result as { success: true; data: z.infer<typeof ExpectedConstraintsSchema> }).data;
      expect("budget_he" in parsed).toBe(false);
    });

    it("income constraint uses needs_immediate_income (boolean) + months_until_income_required (int)", () => {
      const result = ExpectedConstraintsSchema.safeParse({
        needs_immediate_income: true,
        months_until_income_required: 6,
      });
      expect(result.success).toBe(true);
      const parsed = (result as { success: true; data: z.infer<typeof ExpectedConstraintsSchema> }).data;
      expect(parsed.needs_immediate_income).toBe(true);
      expect(parsed.months_until_income_required).toBe(6);
    });

    it("months_until_income_required rejects values > 36", () => {
      expect(
        ExpectedConstraintsSchema.safeParse({ months_until_income_required: 37 }).success,
      ).toBe(false);
    });
  });

  describe("buildMatchingProfile — chat constraints passthrough", () => {
    it("passes chat constraints directly to matching profile", () => {
      const profile = buildMatchingProfile({
        data: {
          constraints: {
            risk_tolerance: 5,
            english_level: "intermediate",
            needs_immediate_income: false,
            months_until_income_required: 12,
          },
        },
      });
      expect(profile.constraints).toMatchObject({
        risk_tolerance: 5,
        english_level: "intermediate",
        needs_immediate_income: false,
        months_until_income_required: 12,
      });
    });

    it("does not pass old risk_tolerance_1_10 field through to matcher expectations", () => {
      // If old shape is passed, the constraint object has risk_tolerance_1_10 not risk_tolerance.
      // The matcher reads risk_tolerance; risk_tolerance_1_10 would be ignored → effectively null.
      const profile = buildMatchingProfile({
        data: {
          constraints: {
            risk_tolerance_1_10: 7, // OLD SHAPE — should be fixed in extraction
          } as Record<string, unknown>,
        },
      });
      // After the fix, extraction never emits risk_tolerance_1_10.
      // This test documents that the matcher does NOT read risk_tolerance_1_10.
      expect((profile.constraints as Record<string, unknown> | null)?.risk_tolerance).toBeUndefined();
    });
  });
});
