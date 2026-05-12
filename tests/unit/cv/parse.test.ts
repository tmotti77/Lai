import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { extractText } from "@/lib/cv/parse";

const FIXTURES_DIR = join(process.cwd(), "scripts");
const PDF_MIME = "application/pdf";

const fixtures = {
  sparse: join(FIXTURES_DIR, "test-cv-sparse.pdf"),
  teacher: join(FIXTURES_DIR, "test-cv-teacher.pdf"),
  blank: join(FIXTURES_DIR, "test-cv-blank.pdf"),
};

const allPresent = Object.values(fixtures).every(existsSync);
const skipMsg = "fixtures missing — run npx tsx scripts/generate-cv-*.tsx to regenerate";

describe.skipIf(!allPresent)("extractText (PDF)", () => {
  it("extracts Hebrew content from sparse post-army CV", async () => {
    const buffer = readFileSync(fixtures.sparse);
    const result = await extractText(buffer, PDF_MIME);
    expect(result.text.length).toBeGreaterThan(100);
    expect(result.text).toContain("תומר לוי");
    expect(result.truncated).toBe(false);
  });

  it("extracts richer Hebrew content from teacher CV", async () => {
    const buffer = readFileSync(fixtures.teacher);
    const result = await extractText(buffer, PDF_MIME);
    expect(result.text.length).toBeGreaterThan(500);
    expect(result.text).toContain("נועה פרידמן");
    expect(result.text).toContain("מורה לאנגלית");
  });

  it("throws empty_text on a PDF with no extractable text content", async () => {
    // The blank fixture has zero <Text> nodes, only shape <View>s — pdf-parse
    // returns only its own "-- N of M --" page-marker artifact, which we strip
    // before the emptiness check. The remaining string is empty, so we throw.
    const buffer = readFileSync(fixtures.blank);
    await expect(extractText(buffer, PDF_MIME)).rejects.toThrow("empty_text");
  });

  it("strips pdf-parse v2 page markers from content PDFs", async () => {
    // Regression guard: content PDFs must not leak the "-- 1 of 1 --" delimiter
    // into the text that gets sent to the LLM.
    const buffer = readFileSync(fixtures.sparse);
    const result = await extractText(buffer, PDF_MIME);
    expect(result.text).not.toMatch(/--\s*\d+\s+of\s+\d+\s*--/);
  });

  it(skipMsg, () => {
    // intentionally empty — describe.skipIf hides this whole block when
    // fixtures are missing; this dummy preserves the "skipped" surface so
    // a developer can see why.
  });
});

describe("extractText (errors)", () => {
  it("throws unsupported_mime on unrecognised MIME type", async () => {
    const buffer = Buffer.from("anything");
    await expect(extractText(buffer, "image/png")).rejects.toThrow("unsupported_mime");
  });
});
