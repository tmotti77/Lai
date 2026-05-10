import { describe, it, expect } from "vitest";
import { scoreBig5 } from "@/lib/assessment/big5/score";
import { BIG5_ITEMS, BIG5_ITEMS_VERSION } from "@/lib/assessment/big5/items";

describe("scoreBig5", () => {
  it("returns 50 for all traits when responses are midpoint", () => {
    const responses = Object.fromEntries(BIG5_ITEMS.map((i) => [i.id, 3]));
    const scores = scoreBig5(responses, BIG5_ITEMS_VERSION);
    expect(scores.O).toBe(50);
    expect(scores.C).toBe(50);
    expect(scores.E).toBe(50);
    expect(scores.A).toBe(50);
    expect(scores.N).toBe(50);
  });

  it("reverse-keyed items invert the response when scoring", () => {
    // For trait O: O1 (positive) = 5, O2 (positive) = 5, O3 (reverse) = 1, O4 (reverse) = 1
    // Effective: O1=5, O2=5, O3=6-1=5, O4=6-1=5 → mean=5 → 100
    const responses: Record<string, number> = {};
    for (const item of BIG5_ITEMS) {
      if (item.trait === "O") {
        responses[item.id] = item.reverseKeyed ? 1 : 5;
      } else {
        responses[item.id] = 3;
      }
    }
    const scores = scoreBig5(responses, BIG5_ITEMS_VERSION);
    expect(scores.O).toBe(100);
    expect(scores.C).toBe(50);
  });

  it("returns 0 for a trait when all effective responses are 1", () => {
    const responses: Record<string, number> = {};
    for (const item of BIG5_ITEMS) {
      if (item.trait === "N") {
        responses[item.id] = item.reverseKeyed ? 5 : 1;
      } else {
        responses[item.id] = 3;
      }
    }
    const scores = scoreBig5(responses, BIG5_ITEMS_VERSION);
    expect(scores.N).toBe(0);
  });

  it("throws on missing response", () => {
    const responses = Object.fromEntries(BIG5_ITEMS.slice(0, 5).map((i) => [i.id, 3]));
    expect(() => scoreBig5(responses, BIG5_ITEMS_VERSION)).toThrow(/missing/i);
  });

  it("throws on out-of-range response", () => {
    const responses = Object.fromEntries(BIG5_ITEMS.map((i) => [i.id, 3]));
    responses["O1"] = 0;
    expect(() => scoreBig5(responses, BIG5_ITEMS_VERSION)).toThrow(/range/i);
  });

  it("throws on unsupported items_version", () => {
    const responses = Object.fromEntries(BIG5_ITEMS.map((i) => [i.id, 3]));
    expect(() => scoreBig5(responses, 999)).toThrow(/version/i);
  });
});
