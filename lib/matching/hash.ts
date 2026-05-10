import { createHash } from "node:crypto";
import type { MatchingProfile } from "./types";

export function profileHash(profile: MatchingProfile, catalogVersion: number): string {
  const stable = stableStringify({ profile, catalogVersion });
  return createHash("sha1").update(stable).digest("hex");
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(",")}}`;
}
