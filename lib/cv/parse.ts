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
    // unpdf is designed for serverless environments and requires NO canvas polyfills.
    // It uses pdfjs-dist's text-extraction path only, avoiding all DOM/canvas APIs.
    const { extractText: unpdfExtract, getDocumentProxy } = await import("unpdf");
    try {
      // unpdf requires Uint8Array; Node Buffer is a subclass but unpdf rejects it
      const uint8 = new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
      const pdf = await getDocumentProxy(uint8);
      const { text } = await unpdfExtract(pdf, { mergePages: true });
      raw = text;
    } catch (err) {
      // unpdf may throw on malformed PDFs; wrap with context
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`unpdf_failed: ${message}`);
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
    // pdf-parse v2 appends "-- N of M --" page delimiters; strip them so they
    // (a) don't slip past empty_text detection when a PDF has no real content,
    // (b) don't waste LLM tokens on noise.
    .replace(/^--\s*\d+\s+of\s+\d+\s*--$/gm, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
