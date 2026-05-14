import { describe, it, expect } from "vitest";
import { PERSONAS, getPersona } from "@/lib/interview/personas";
import { PERSONA_IDS } from "@/lib/interview/types";

describe("interview personas", () => {
  it("exposes exactly 3 personas matching PERSONA_IDS", () => {
    const ids = PERSONAS.map((p) => p.id).sort();
    expect(ids).toEqual([...PERSONA_IDS].sort());
    expect(PERSONAS).toHaveLength(3);
  });

  it("each persona has non-empty label, description, and overlay", () => {
    for (const p of PERSONAS) {
      expect(p.label_he.trim().length).toBeGreaterThan(0);
      expect(p.description_he.trim().length).toBeGreaterThan(0);
      expect(p.system_prompt_overlay.trim().length).toBeGreaterThan(50);
    }
  });

  it("no proper-noun first names in any overlay (no interviewer names)", () => {
    // Common Israeli first names we explicitly decided not to use.
    const bannedNames = ["אורית", "דניאל", "מיכל", "רוני", "טל", "עמית", "יוסי", "שירה"];
    for (const p of PERSONAS) {
      for (const name of bannedNames) {
        expect(p.system_prompt_overlay).not.toContain(name);
      }
    }
  });

  it("getPersona returns the right one and throws on unknown id", () => {
    expect(getPersona("hr").id).toBe("hr");
    expect(getPersona("technical").id).toBe("technical");
    // @ts-expect-error — testing runtime guard
    expect(() => getPersona("salary_negotiation")).toThrow();
  });
});
