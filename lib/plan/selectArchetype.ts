import type { Paths } from "@/lib/matching/types";
import type { Archetype } from "./types";

export function selectArchetype(paths: Paths): Archetype | null {
  if (paths.safe) return "apply";
  if (paths.growth) return "taste_test";
  if (paths.wildcard) return "research";
  return null;
}
