import { describe, it, expect } from "vitest";
import { inferArchetype, categoryDistribution } from "@/lib/cv/archetype";

describe("inferArchetype", () => {
  it("returns generalist for empty input", () => {
    expect(inferArchetype([])).toBe("generalist");
  });

  it("returns builder when technical is dominant (>= 45%)", () => {
    const cats = ["technical", "technical", "technical", "social", "managerial"];
    expect(inferArchetype(cats)).toBe("builder");
  });

  it("returns connector when social is dominant", () => {
    const cats = ["social", "social", "social", "social", "technical"];
    expect(inferArchetype(cats)).toBe("connector");
  });

  it("returns analyst when analytical is dominant", () => {
    const cats = ["analytical", "analytical", "analytical", "technical"];
    expect(inferArchetype(cats)).toBe("analyst");
  });

  it("returns leader when managerial is dominant", () => {
    const cats = ["managerial", "managerial", "managerial", "social"];
    expect(inferArchetype(cats)).toBe("leader");
  });

  it("returns creator when creative is dominant", () => {
    const cats = ["creative", "creative", "creative", "technical"];
    expect(inferArchetype(cats)).toBe("creator");
  });

  it("returns generalist when no category passes the 45% threshold", () => {
    const cats = ["technical", "social", "managerial", "analytical", "creative"];
    expect(inferArchetype(cats)).toBe("generalist");
  });

  it("returns generalist when dominant category is unknown", () => {
    const cats = ["unknown_category", "unknown_category", "unknown_category", "soft"];
    expect(inferArchetype(cats)).toBe("generalist");
  });

  it("handles single-skill input by treating it as dominant", () => {
    expect(inferArchetype(["technical"])).toBe("builder");
  });
});

describe("categoryDistribution", () => {
  it("returns empty object for empty input", () => {
    expect(categoryDistribution([])).toEqual({});
  });

  it("counts occurrences of each category", () => {
    const cats = ["technical", "technical", "social", "managerial", "managerial", "managerial"];
    expect(categoryDistribution(cats)).toEqual({
      technical: 2,
      social: 1,
      managerial: 3,
    });
  });
});
