import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { globSync } from "tinyglobby";

// #63 step 2: <Analytics> must mount exactly once in the app, through ConsentedAnalytics,
// so the default-deny gate (decision 3) can't be bypassed by a future unconditional import.
const ROOT = path.resolve(__dirname, "../../..");
const ANALYTICS_IMPORT = /@vercel\/analytics\/(next|react)/;
const ALLOWED_FILE = "components/cookie-consent/ConsentedAnalytics.tsx";

const files = [...globSync("app/**/*.tsx", { cwd: ROOT }), ...globSync("components/**/*.tsx", { cwd: ROOT })].sort();

describe("no direct @vercel/analytics import outside ConsentedAnalytics", () => {
  it("matches the files it is meant to guard", () => {
    expect(files).toContain(ALLOWED_FILE);
    expect(files).toContain("app/layout.tsx");
  });

  it.each(files)("%s", (file) => {
    const src = readFileSync(path.join(ROOT, file), "utf8");
    if (file === ALLOWED_FILE) {
      expect(src).toMatch(ANALYTICS_IMPORT);
    } else {
      expect(src).not.toMatch(ANALYTICS_IMPORT);
    }
  });
});
