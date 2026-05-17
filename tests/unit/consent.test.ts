import { describe, it, expect, vi, beforeEach } from "vitest";
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

vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: vi.fn(),
}));

import { createServiceClient } from "@/lib/supabase/service";
import { requireConsent, NoConsentError } from "@/lib/consent";

function mockClient(consents: Array<{ purpose: string; revoked_at: string | null }>) {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({
          is: () => ({
            in: () => Promise.resolve({ data: consents, error: null }),
          }),
        }),
      }),
    }),
  };
}

beforeEach(() => vi.clearAllMocks());

describe("requireConsent", () => {
  it("resolves when all required purposes have active consent", async () => {
    (createServiceClient as ReturnType<typeof vi.fn>).mockReturnValue(
      mockClient([
        { purpose: "processing", revoked_at: null },
        { purpose: "disclaimer", revoked_at: null },
      ]),
    );
    await expect(requireConsent("user-1", ["processing", "disclaimer"])).resolves.toBeUndefined();
  });

  it("throws NoConsentError when a required purpose is missing", async () => {
    (createServiceClient as ReturnType<typeof vi.fn>).mockReturnValue(
      mockClient([{ purpose: "processing", revoked_at: null }]),
    );
    await expect(requireConsent("user-1", ["processing", "disclaimer"])).rejects.toBeInstanceOf(NoConsentError);
  });

  it("throws NoConsentError when a required purpose was revoked", async () => {
    (createServiceClient as ReturnType<typeof vi.fn>).mockReturnValue(
      mockClient([]),
    );
    await expect(requireConsent("user-1", ["processing"])).rejects.toBeInstanceOf(NoConsentError);
  });

  it("defaults to checking processing + disclaimer when no purposes specified", async () => {
    (createServiceClient as ReturnType<typeof vi.fn>).mockReturnValue(
      mockClient([
        { purpose: "processing", revoked_at: null },
        { purpose: "disclaimer", revoked_at: null },
      ]),
    );
    await expect(requireConsent("user-1")).resolves.toBeUndefined();
  });
});
