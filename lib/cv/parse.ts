import "server-only";
import { MAX_EXTRACTED_TEXT_CHARS } from "./types";

export type ParseResult = {
  text: string;
  truncated: boolean;
};

export async function extractText(
  buffer: Buffer,
  mimeType: string,
): Promise<ParseResult> {
  let raw: string;

  if (mimeType === "application/pdf") {
    // pdf-parse v2 uses a class-based API.
    const { PDFParse } = await import("pdf-parse");
    const parser = new PDFParse({ data: buffer });
    try {
      const result = await parser.getText();
      raw = result.text;
    } finally {
      await parser.destroy();
    }
  } else if (
    mimeType ===
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  ) {
    const mammoth = await import("mammoth");
    const { value } = await mammoth.extractRawText({ buffer });
    raw = value;
  } else {
    throw new Error(`unsupported_mime: ${mimeType}`);
  }

  const normalized = normalizeWhitespace(raw);
  if (normalized.length === 0) {
    throw new Error("empty_text");
  }

  const truncated = normalized.length > MAX_EXTRACTED_TEXT_CHARS;
  return {
    text: truncated ? normalized.slice(0, MAX_EXTRACTED_TEXT_CHARS) : normalized,
    truncated,
  };
}

function normalizeWhitespace(text: string): string {
  return text
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
