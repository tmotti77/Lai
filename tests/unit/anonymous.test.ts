import { describe, it, expect } from "vitest";
import { generateAnonymousToken, ANON_COOKIE_NAME } from "@/lib/anonymous";

describe("anonymous helpers", () => {
  it("generateAnonymousToken returns a 32+ char url-safe token", () => {
    const token = generateAnonymousToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(token.length).toBeGreaterThanOrEqual(32);
  });

  it("two generated tokens are different", () => {
    expect(generateAnonymousToken()).not.toBe(generateAnonymousToken());
  });

  it("ANON_COOKIE_NAME is stable", () => {
    expect(ANON_COOKIE_NAME).toBe("co_anon");
  });
});
