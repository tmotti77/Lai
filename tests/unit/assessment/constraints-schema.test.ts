import { describe, it, expect } from "vitest";
import { ConstraintsSchema, CONSTRAINTS_VERSION } from "@/lib/assessment/constraints/schema";

describe("ConstraintsSchema", () => {
  it("accepts a minimal valid submission with only required fields", () => {
    const result = ConstraintsSchema.safeParse({
      location_he: "מרכז",
      time_per_week_hours: 10,
      training_budget_nis: 0,
    });
    expect(result.success).toBe(true);
  });

  it("accepts a fully populated submission", () => {
    const result = ConstraintsSchema.safeParse({
      location_he: "צפון",
      remote_ok: true,
      time_per_week_hours: 20,
      training_budget_nis: 5000,
      english_level: "intermediate",
      risk_tolerance: 7,
      needs_immediate_income: false,
      months_until_income_required: 6,
    });
    expect(result.success).toBe(true);
  });

  it("rejects negative budget", () => {
    const result = ConstraintsSchema.safeParse({
      location_he: "מרכז",
      time_per_week_hours: 10,
      training_budget_nis: -100,
    });
    expect(result.success).toBe(false);
  });

  it("rejects time_per_week_hours > 60", () => {
    const result = ConstraintsSchema.safeParse({
      location_he: "מרכז",
      time_per_week_hours: 80,
      training_budget_nis: 0,
    });
    expect(result.success).toBe(false);
  });

  it("rejects risk_tolerance outside 1..10", () => {
    const result = ConstraintsSchema.safeParse({
      location_he: "מרכז",
      time_per_week_hours: 10,
      training_budget_nis: 0,
      risk_tolerance: 11,
    });
    expect(result.success).toBe(false);
  });

  it("exports a schema version constant", () => {
    expect(typeof CONSTRAINTS_VERSION).toBe("number");
  });
});
