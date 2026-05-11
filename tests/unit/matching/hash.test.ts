import { describe, it, expect } from "vitest";
import { profileHash } from "@/lib/matching/hash";
import type { MatchingProfile } from "@/lib/matching/types";

const empty: MatchingProfile = {
  interests: null, skills: null, values: null, big5: null, constraints: null,
};

describe("profileHash", () => {
  it("returns the same hash for the same profile + version", () => {
    const a = profileHash(empty, 1);
    const b = profileHash(empty, 1);
    expect(a).toBe(b);
  });

  it("returns different hashes when catalog version differs", () => {
    expect(profileHash(empty, 1)).not.toBe(profileHash(empty, 2));
  });

  it("returns different hashes when profile content differs", () => {
    const withInterests: MatchingProfile = {
      ...empty,
      interests: { R: 50, I: 50, A: 50, S: 50, E: 50, C: 50 },
    };
    expect(profileHash(empty, 1)).not.toBe(profileHash(withInterests, 1));
  });

  it("is order-independent for fields", () => {
    const p1: MatchingProfile = {
      ...empty,
      values: { topThree: ["a","b","c"], alsoPicked: ["x","y"] },
    };
    const p2: MatchingProfile = {
      values: { topThree: ["a","b","c"], alsoPicked: ["x","y"] },
      interests: null, skills: null, big5: null, constraints: null,
    };
    expect(profileHash(p1, 1)).toBe(profileHash(p2, 1));
  });
});
