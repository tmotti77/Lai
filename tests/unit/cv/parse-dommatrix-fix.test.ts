import { describe, it, expect } from "vitest";
import { extractText } from "@/lib/cv/parse";

describe("CV PDF parse with DOMMatrix fix", () => {
  it("should not throw DOMMatrix error when parsing PDF", async () => {
    // Create a minimal valid PDF buffer
    const minimalPdf = Buffer.from(
      "%PDF-1.4\n" +
      "1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n" +
      "2 0 obj<</Type/Pages/Count 1/Kids[3 0 R]>>endobj\n" +
      "3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Contents 4 0 R>>endobj\n" +
      "4 0 obj<</Length 44>>stream\n" +
      "BT\n" +
      "/F1 12 Tf\n" +
      "100 700 Td\n" +
      "(Test CV content) Tj\n" +
      "ET\n" +
      "endstream\nendobj\n" +
      "xref\n" +
      "0 5\n" +
      "0000000000 65535 f\n" +
      "0000000009 00000 n\n" +
      "0000000056 00000 n\n" +
      "0000000115 00000 n\n" +
      "0000000214 00000 n\n" +
      "trailer<</Size 5/Root 1 0 R>>\n" +
      "startxref\n" +
      "306\n" +
      "%%EOF"
    );

    // This should not throw "DOMMatrix is not defined"
    const result = await extractText(minimalPdf, "application/pdf");
    
    expect(result).toBeDefined();
    expect(result.text).toBeTruthy();
    expect(typeof result.text).toBe("string");
  });

  it("should extract text from PDF buffer", async () => {
    const minimalPdf = Buffer.from(
      "%PDF-1.4\n" +
      "1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n" +
      "2 0 obj<</Type/Pages/Count 1/Kids[3 0 R]>>endobj\n" +
      "3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Contents 4 0 R>>endobj\n" +
      "4 0 obj<</Length 44>>stream\n" +
      "BT\n" +
      "/F1 12 Tf\n" +
      "100 700 Td\n" +
      "(Hands-on skills) Tj\n" +
      "ET\n" +
      "endstream\nendobj\n" +
      "xref\n" +
      "0 5\n" +
      "0000000000 65535 f\n" +
      "0000000009 00000 n\n" +
      "0000000056 00000 n\n" +
      "0000000115 00000 n\n" +
      "0000000214 00000 n\n" +
      "trailer<</Size 5/Root 1 0 R>>\n" +
      "startxref\n" +
      "306\n" +
      "%%EOF"
    );

    const result = await extractText(minimalPdf, "application/pdf");
    
    expect(result.text.length).toBeGreaterThan(0);
    expect(result.truncated).toBe(false);
  });
});
