import { describe, it, expect } from "vitest";
import { isStorageNotFound } from "@/lib/privacy/storage";

// Shapes as storage-js builds them: StorageApiError(message, status, statusCode), where
// statusCode comes from the body's statusCode, else its code, else the HTTP status.
describe("isStorageNotFound", () => {
  it.each([
    ["legacy 400 with body statusCode 404", { message: "Object not found", status: 400, statusCode: "404" }],
    ["HTTP 404", { message: "Object not found", status: 404, statusCode: "404" }],
    ["S3-style NoSuchKey", { message: "The specified key does not exist.", status: 404, statusCode: "NoSuchKey" }],
    ["statusCode only", { message: "Object not found", statusCode: "404" }],
  ])("%s → not found", (_label, error) => {
    expect(isStorageNotFound(error)).toBe(true);
  });

  it.each([
    ["5xx", { message: "Internal Server Error", status: 500, statusCode: "500" }],
    ["rate limited", { message: "Too many requests", status: 429, statusCode: "429" }],
    ["bad JWT", { message: "invalid signature", status: 400, statusCode: "InvalidJWT" }],
    ["forbidden", { message: "new row violates row-level security policy", status: 403, statusCode: "403" }],
    ["network (StorageUnknownError)", { message: "fetch failed" }],
    ["null", null],
  ])("%s → not a not-found", (_label, error) => {
    expect(isStorageNotFound(error)).toBe(false);
  });
});
