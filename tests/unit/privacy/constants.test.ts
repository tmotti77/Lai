import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { DELETE_CONFIRMATION } from "@/lib/privacy/constants";
import { DeleteRequestBody, DELETE_CONFIRMATION as REEXPORTED } from "@/lib/privacy/delete";

// The confirmation token moved to a client-safe module (#51 part 2): the dialog imports it,
// the route validates against it. One source of truth, no server-only in the client bundle.
describe("lib/privacy/constants", () => {
  it("has no server-only import", () => {
    const src = readFileSync(path.resolve(__dirname, "../../../lib/privacy/constants.ts"), "utf8");
    expect(src).not.toMatch(/server-only/);
  });

  it("is the token the delete route accepts", () => {
    expect(REEXPORTED).toBe(DELETE_CONFIRMATION);
    expect(DeleteRequestBody.safeParse({ confirmation: DELETE_CONFIRMATION }).success).toBe(true);
    expect(DeleteRequestBody.safeParse({ confirmation: "מחק" }).success).toBe(false);
  });
});
