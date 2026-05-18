import { describe, it, expect } from "vitest";
import { escapeCsv } from "@/app/api/admin/feedback/export/route";

describe("escapeCsv", () => {
  it("returns empty string for null/undefined", () => {
    expect(escapeCsv(null)).toBe("");
    expect(escapeCsv(undefined)).toBe("");
  });

  it("returns simple strings as-is", () => {
    expect(escapeCsv("hello")).toBe("hello");
    expect(escapeCsv("שלום")).toBe("שלום");
  });

  it("quotes values containing commas", () => {
    expect(escapeCsv("a, b")).toBe('"a, b"');
  });

  it("quotes values containing newlines", () => {
    expect(escapeCsv("line1\nline2")).toBe('"line1\nline2"');
  });

  it("escapes embedded double quotes by doubling them", () => {
    expect(escapeCsv('say "hi"')).toBe('"say ""hi"""');
  });

  it("prefixes formula-injection chars with apostrophe", () => {
    expect(escapeCsv("=SUM(A1)")).toBe("'=SUM(A1)");
    expect(escapeCsv("+1+1")).toBe("'+1+1");
    expect(escapeCsv("-cmd")).toBe("'-cmd");
    expect(escapeCsv("@user")).toBe("'@user");
  });

  it("serializes objects as JSON", () => {
    expect(escapeCsv({ a: 1 })).toBe('{"a":1}');
  });
});
