import { describe, it, expect } from "vitest";
import { buildMatchingProfile } from "@/lib/matching/profile";

describe("buildMatchingProfile", () => {
  it("returns all-null when input is null", () => {
    const profile = buildMatchingProfile(null);
    expect(profile).toEqual({
      interests: null,
      skills: null,
      values: null,
      big5: null,
      constraints: null,
    });
  });

  it("returns all-null when input has no data and no formal", () => {
    const profile = buildMatchingProfile({});
    expect(profile.interests).toBeNull();
    expect(profile.skills).toBeNull();
    expect(profile.values).toBeNull();
    expect(profile.big5).toBeNull();
    expect(profile.constraints).toBeNull();
  });

  it("uses formal RIASEC scores when present", () => {
    const profile = buildMatchingProfile({
      formal: {
        riasec: { scores: { R: 60, I: 80, A: 30, S: 20, E: 40, C: 50 } },
        big5: null, values: null, constraints: null,
      },
    });
    expect(profile.interests).toEqual({ R: 60, I: 80, A: 30, S: 20, E: 40, C: 50 });
  });

  it("uses formal Big5 scores when present", () => {
    const profile = buildMatchingProfile({
      formal: {
        riasec: null,
        big5: { scores: { O: 70, C: 65, E: 50, A: 60, N: 40 } },
        values: null, constraints: null,
      },
    });
    expect(profile.big5).toEqual({ O: 70, C: 65, E: 50, A: 60, N: 40 });
  });

  it("prefers formal values over chat-extracted values", () => {
    const profile = buildMatchingProfile({
      data: { values: ["money", "freedom", "learning", "team", "balance"] },
      formal: {
        riasec: null, big5: null, constraints: null,
        values: { scores: { topThree: ["impact", "service", "team"], alsoPicked: ["learning"] } },
      },
    });
    expect(profile.values).toEqual({
      topThree: ["impact", "service", "team"],
      alsoPicked: ["learning"],
    });
  });

  it("falls back to chat-extracted values when formal is absent", () => {
    const profile = buildMatchingProfile({
      data: { values: ["money", "freedom", "learning", "team", "balance"] },
    });
    expect(profile.values).toEqual({
      topThree: ["money", "freedom", "learning"],
      alsoPicked: ["team", "balance"],
    });
  });

  it("returns null values when chat-extracted values is empty array", () => {
    const profile = buildMatchingProfile({
      data: { values: [] },
    });
    expect(profile.values).toBeNull();
  });

  it("prefers formal constraints over chat-extracted constraints", () => {
    const profile = buildMatchingProfile({
      data: { constraints: { location_he: "צפון", time_per_week_hours: 5 } },
      formal: {
        riasec: null, big5: null, values: null,
        constraints: { scores: { location_he: "מרכז", time_per_week_hours: 20, training_budget_nis: 30000 } },
      },
    });
    expect(profile.constraints?.location_he).toBe("מרכז");
    expect(profile.constraints?.time_per_week_hours).toBe(20);
    expect(profile.constraints?.training_budget_nis).toBe(30000);
  });

  it("maps chat-extracted skill confidence to numeric level", () => {
    const profile = buildMatchingProfile({
      data: {
        skills: [
          { label_he: "תכנות", confidence: "high" },
          { label_he: "מכירות", confidence: "medium" },
          { label_he: "עיצוב", confidence: "low" },
          { label_he: "ניהול" }, // no confidence → defaults to medium
        ],
      },
    });
    expect(profile.skills).toEqual([
      { id: "תכנות", level: 1.0 },
      { id: "מכירות", level: 0.6 },
      { id: "עיצוב", level: 0.3 },
      { id: "ניהול", level: 0.6 },
    ]);
  });

  it("returns null skills when chat-extracted skills is empty", () => {
    const profile = buildMatchingProfile({ data: { skills: [] } });
    expect(profile.skills).toBeNull();
  });
});
