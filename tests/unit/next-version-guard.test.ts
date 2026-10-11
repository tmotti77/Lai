import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Guards issue #52: next <= 16.3.7 is in the npm-audit range for critical
// advisories (proxy bypass, Server Action DoS/SSRF, cache confusion).
const MIN_SAFE_NEXT = [16, 3, 8] as const;

function readJson(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(process.cwd(), path), "utf8"));
}

function parseVersion(v: string): number[] {
  const core = v.split("-")[0];
  return core.split(".").map(Number);
}

function isAtLeast(v: string, min: readonly number[]): boolean {
  const parts = parseVersion(v);
  for (let i = 0; i < min.length; i++) {
    if (parts[i] !== min[i]) return parts[i] > min[i];
  }
  return true;
}

describe("next version guard", () => {
  it("installed next is outside the audited vulnerable range", () => {
    const { version } = readJson("node_modules/next/package.json") as { version: string };
    expect(isAtLeast(version, MIN_SAFE_NEXT)).toBe(true);
  });

  it("pins next and eslint-config-next to the same exact version", () => {
    const pkg = readJson("package.json") as {
      dependencies: Record<string, string>;
      devDependencies: Record<string, string>;
    };
    const next = pkg.dependencies.next;
    expect(next).toMatch(/^\d+\.\d+\.\d+$/);
    expect(pkg.devDependencies["eslint-config-next"]).toBe(next);
  });
});
