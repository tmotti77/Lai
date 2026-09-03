import { describe, it, expect } from "vitest";
import { normalizePath } from "@/components/chat/MessageBubble";

describe("MessageBubble normalizePath", () => {
  it("normalizes relative path without leading slash", () => {
    expect(normalizePath("recommendations")).toBe("/recommendations");
  });

  it("normalizes relative path with trailing slash", () => {
    expect(normalizePath("recommendations/")).toBe("/recommendations");
  });

  it("preserves absolute path with leading slash", () => {
    expect(normalizePath("/recommendations")).toBe("/recommendations");
  });

  it("preserves absolute http URL", () => {
    expect(normalizePath("https://example.com")).toBe("https://example.com");
  });

  it("preserves absolute https URL", () => {
    expect(normalizePath("https://example.com/path")).toBe("https://example.com/path");
  });

  it("handles empty string", () => {
    expect(normalizePath("")).toBe("");
  });

  it("handles complex relative path", () => {
    expect(normalizePath("recommendations/detail/")).toBe("/recommendations/detail");
  });
});
