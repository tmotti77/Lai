import taxonomyJson from "@/content/skills/taxonomy.json";
import type { ExtractedSkill } from "./types";

type TaxonomyEntry = { id: string };

const TAXONOMY_IDS: Set<string> = new Set(
  (taxonomyJson as { skills: TaxonomyEntry[] }).skills.map((s) => s.id),
);

/**
 * Defense-in-depth against LLM taxonomy-id hallucinations.
 *
 * The system prompt forbids inventing ids (see lib/cv/prompt.ts), but the
 * model still occasionally emits plausible-but-wrong ids — e.g. `curriculum-design`
 * when only `child-development` and `teaching` exist. Those silent failures
 * waste matching signal because no occupation references the invented id.
 *
 * This function maps any id that is neither (a) in the taxonomy nor (b) already
 * prefixed `other:` into the `other:<id>` namespace. The original id is
 * preserved as the body of the `other:` id so the user still sees a meaningful
 * label in the review UI.
 *
 * Pure / no I/O — safe to call in route handlers and tests.
 */
export function canonicalizeExtractedSkills(
  skills: ExtractedSkill[],
): ExtractedSkill[] {
  return skills.map((s) => {
    if (s.id.startsWith("other:")) return s;
    if (TAXONOMY_IDS.has(s.id)) return s;
    return { ...s, id: `other:${s.id}` };
  });
}
