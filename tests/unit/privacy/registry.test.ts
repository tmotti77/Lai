import { describe, it, expect } from "vitest";
import { USER_DATA_TABLES, STORAGE_BUCKETS } from "@/lib/privacy/registry";

describe("privacy registry", () => {
  it("scopes career_profile by user_id, never via conversation, so orphan profiles are covered", () => {
    expect(USER_DATA_TABLES.career_profile.scope).toEqual({ kind: "user_id" });
  });

  it("redacts the live anonymous session token from exports", () => {
    expect(USER_DATA_TABLES.anonymous_sessions.redact).toContain("token");
  });

  it("finds CV objects under the user's own folder", () => {
    expect(STORAGE_BUCKETS["cv-uploads"].folder("u-1")).toBe("u-1");
  });
});
