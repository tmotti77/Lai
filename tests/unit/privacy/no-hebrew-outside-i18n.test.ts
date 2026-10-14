import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { globSync } from "tinyglobby";

// Hebrew strings live in lib/i18n/he.ts only (#51 part 2, plan §4.4). Checks for Hebrew
// literals directly, independent of how a file gets its strings (import or props).
const ROOT = path.resolve(__dirname, "../../..");
const HEBREW = /[֐-׿]/;

const PAGES = ["app/(app)/settings/page.tsx", "app/(marketing)/privacy/page.tsx", "app/page.tsx"];
const files = [
  ...globSync("components/settings/**/*.{ts,tsx}", { cwd: ROOT }),
  ...globSync("components/cookie-consent/**/*.{ts,tsx}", { cwd: ROOT }),
  ...PAGES,
].sort();

describe("no Hebrew literals outside lib/i18n", () => {
  it("matches the files it is meant to guard", () => {
    expect(files.length).toBeGreaterThan(PAGES.length);
    for (const f of [
      "components/settings/DataRightsPanel.tsx",
      "components/settings/DeleteAccountDialog.tsx",
      "components/settings/messages.ts",
      "components/settings/useDataExport.ts",
      "components/cookie-consent/CookieBanner.tsx",
    ]) {
      expect(files).toContain(f);
    }
  });

  it.each(files)("%s", (file) => {
    const lines = readFileSync(path.join(ROOT, file), "utf8").split("\n");
    const offending = lines.flatMap((line, i) => (HEBREW.test(line) ? [`${i + 1}: ${line.trim()}`] : []));
    expect(offending).toEqual([]);
  });
});
