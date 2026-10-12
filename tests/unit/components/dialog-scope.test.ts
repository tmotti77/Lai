import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

// claude-review #58 note 5: the viewport-height cap + scroll belongs to the delete
// dialog only; the shared DialogContent (used by SaveReportDialog etc.) stays unchanged.
describe("dialog height/scroll scoping", () => {
  it("shared DialogContent has no max-h/overflow classes", () => {
    const src = readFileSync("components/ui/dialog.tsx", "utf8");
    expect(src).not.toMatch(/max-h-\[calc\(100dvh/);
    expect(src).not.toMatch(/overflow-y-auto/);
  });
  it("DeleteAccountDialog applies the cap itself", () => {
    const src = readFileSync("components/settings/DeleteAccountDialog.tsx", "utf8");
    expect(src).toMatch(/max-h-\[calc\(100dvh-2rem\)\]/);
    expect(src).toMatch(/overflow-y-auto/);
  });
});
