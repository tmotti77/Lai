import { describe, it, expect } from "vitest";
import { CONSENT_VERSION, CONSENT_PURPOSES } from "@/lib/consent";

describe("consent constants", () => {
  it("CONSENT_VERSION is set", () => {
    expect(CONSENT_VERSION).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("CONSENT_PURPOSES includes processing and disclaimer", () => {
    expect(CONSENT_PURPOSES).toContain("processing");
    expect(CONSENT_PURPOSES).toContain("disclaimer");
  });
});
