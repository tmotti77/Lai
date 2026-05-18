import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@vercel/analytics/server", () => ({ track: vi.fn().mockResolvedValue(undefined) }));
vi.mock("next/server", () => ({ after: vi.fn((fn: () => void) => fn()) }));

import { track as vercelTrack } from "@vercel/analytics/server";
import { after } from "next/server";
import { track, npsBucket } from "@/lib/analytics";

beforeEach(() => vi.clearAllMocks());

describe("npsBucket", () => {
  it("0-6 is detractor", () => {
    expect(npsBucket(0)).toBe("detractor");
    expect(npsBucket(6)).toBe("detractor");
  });
  it("7-8 is passive", () => {
    expect(npsBucket(7)).toBe("passive");
    expect(npsBucket(8)).toBe("passive");
  });
  it("9-10 is promoter", () => {
    expect(npsBucket(9)).toBe("promoter");
    expect(npsBucket(10)).toBe("promoter");
  });
});

describe("track", () => {
  it("no-ops in test env (process.env.NODE_ENV === 'test')", () => {
    track("conversation_started", { surface: "chat" });
    expect(after).not.toHaveBeenCalled();
    expect(vercelTrack).not.toHaveBeenCalled();
  });

  it("calls vercelTrack via after() when not in test env", () => {
    vi.stubEnv("NODE_ENV", "production");
    try {
      track("conversation_started", { surface: "chat" });
      expect(after).toHaveBeenCalledTimes(1);
      expect(vercelTrack).toHaveBeenCalledWith(
        "conversation_started",
        { surface: "chat" }
      );
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("swallows errors from vercelTrack", () => {
    vi.stubEnv("NODE_ENV", "production");
    (vercelTrack as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("network"));
    try {
      expect(() => track("feedback_submitted", { kind: "thumb", surface: "chat", value: "up" })).not.toThrow();
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
