import { describe, it, expect } from "vitest";
import { scoreRiasec } from "@/lib/assessment/riasec/score";
import { RIASEC_ITEMS, RIASEC_ITEMS_VERSION } from "@/lib/assessment/riasec/items";

describe("scoreRiasec", () => {
  it("returns all-50 when every response is the midpoint (3)", () => {
    const responses = Object.fromEntries(RIASEC_ITEMS.map((i) => [i.id, 3]));
    const scores = scoreRiasec(responses, RIASEC_ITEMS_VERSION);
    expect(scores.R).toBe(50);
    expect(scores.I).toBe(50);
    expect(scores.A).toBe(50);
    expect(scores.S).toBe(50);
    expect(scores.E).toBe(50);
    expect(scores.C).toBe(50);
  });

  it("returns 100 for a type when all its items are 5", () => {
    const responses = Object.fromEntries(
      RIASEC_ITEMS.map((i) => [i.id, i.type === "I" ? 5 : 1]),
    );
    const scores = scoreRiasec(responses, RIASEC_ITEMS_VERSION);
    expect(scores.I).toBe(100);
    expect(scores.R).toBe(0);
  });

  it("computes Holland code from top 3 types", () => {
    // I=5, A=4, S=3, others=1
    const responses = Object.fromEntries(
      RIASEC_ITEMS.map((i) => {
        if (i.type === "I") return [i.id, 5];
        if (i.type === "A") return [i.id, 4];
        if (i.type === "S") return [i.id, 3];
        return [i.id, 1];
      }),
    );
    const scores = scoreRiasec(responses, RIASEC_ITEMS_VERSION);
    expect(scores.hollandCode).toBe("IAS");
  });

  it("throws on missing response", () => {
    const responses = Object.fromEntries(
      RIASEC_ITEMS.slice(0, 5).map((i) => [i.id, 3]),
    );
    expect(() => scoreRiasec(responses, RIASEC_ITEMS_VERSION)).toThrow(/missing/i);
  });

  it("throws on out-of-range response", () => {
    const responses = Object.fromEntries(RIASEC_ITEMS.map((i) => [i.id, 3]));
    responses["R1"] = 6;
    expect(() => scoreRiasec(responses, RIASEC_ITEMS_VERSION)).toThrow(/range/i);
  });

  it("throws on unsupported items_version", () => {
    const responses = Object.fromEntries(RIASEC_ITEMS.map((i) => [i.id, 3]));
    expect(() => scoreRiasec(responses, 999)).toThrow(/version/i);
  });
});
