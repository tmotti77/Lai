import { describe, it, expect } from "vitest";
import { mergeProfileRows, type ProfileRow } from "@/lib/matching/profile-rows";
import { buildMatchingProfile } from "@/lib/matching/profile";

function row(overrides: Partial<ProfileRow>): ProfileRow {
  return {
    id: "row",
    conversation_id: null,
    updated_at: "2026-01-01T00:00:00.000Z",
    data: {},
    ...overrides,
  };
}

describe("mergeProfileRows", () => {
  it("returns null for zero rows", () => {
    expect(mergeProfileRows([], null)).toBeNull();
  });

  it("returns a single row untouched, including id-less and duplicate-id skills", () => {
    const skills = [
      { label_he: "פייתון", confidence: "high" },
      { label_he: "פייתון", confidence: "medium" },
      { id: "dup", name_he: "A", source: "cv" },
      { id: "dup", name_he: "B", source: "cv" },
    ];
    const only = row({
      id: "solo",
      conversation_id: "conv-1",
      data: { skills, interests: ["x"] },
    });

    const merged = mergeProfileRows([only], "conv-1");

    expect(merged).toEqual(only);
    expect((merged as ProfileRow).data).toBe(only.data);
  });

  it("merges orphan CV skills with the conversation row's chat fields", () => {
    const conversationRow = row({
      id: "conv-row",
      conversation_id: "conv-1",
      updated_at: "2026-01-02T00:00:00.000Z",
      data: {
        skills: [],
        interests: ["technology"],
        values: ["impact"],
        constraints: { time_per_week_hours: 40 },
      },
    });
    const orphan = row({
      id: "orphan-row",
      conversation_id: null,
      updated_at: "2026-01-01T00:00:00.000Z",
      data: {
        skills: [
          { id: "python", name_he: "Python", source: "cv" },
          { id: "data-analysis", name_he: "ניתוח נתונים", source: "cv" },
        ],
      },
    });

    const merged = mergeProfileRows([conversationRow, orphan], "conv-1");

    expect(merged?.data?.skills).toEqual([
      { id: "python", name_he: "Python", source: "cv" },
      { id: "data-analysis", name_he: "ניתוח נתונים", source: "cv" },
    ]);
    expect(merged?.data?.interests).toEqual(["technology"]);
    expect(merged?.data?.values).toEqual(["impact"]);
    expect(merged?.data?.constraints).toEqual({ time_per_week_hours: 40 });
  });

  it("unions skills from multiple orphans and lets the newer orphan's constraints win", () => {
    const conversationRow = row({
      id: "conv-row",
      conversation_id: "conv-1",
      updated_at: "2026-01-03T00:00:00.000Z",
      data: { skills: [] },
    });
    const newerOrphan = row({
      id: "orphan-new",
      conversation_id: null,
      updated_at: "2026-01-02T00:00:00.000Z",
      data: {
        skills: [{ id: "python", name_he: "Python", source: "cv" }],
        constraints: { time_per_week_hours: 10 },
      },
    });
    const olderOrphan = row({
      id: "orphan-old",
      conversation_id: null,
      updated_at: "2026-01-01T00:00:00.000Z",
      data: {
        skills: [{ id: "plumbing", name_he: "אינסטלציה", source: "cv" }],
        constraints: { time_per_week_hours: 5 },
      },
    });

    const merged = mergeProfileRows([conversationRow, newerOrphan, olderOrphan], "conv-1");

    expect(merged?.data?.skills).toEqual(
      expect.arrayContaining([
        { id: "python", name_he: "Python", source: "cv" },
        { id: "plumbing", name_he: "אינסטלציה", source: "cv" },
      ]),
    );
    expect(merged?.data?.skills).toHaveLength(2);
    expect(merged?.data?.constraints).toEqual({ time_per_week_hours: 10 });
  });

  it("keeps an older non-latest row's skills (the case the old two-row loader dropped)", () => {
    const primary = row({
      id: "primary",
      conversation_id: "conv-1",
      updated_at: "2026-01-03T00:00:00.000Z",
      data: { skills: [] },
    });
    const newerUnrelated = row({
      id: "unrelated",
      conversation_id: "conv-2",
      updated_at: "2026-01-02T00:00:00.000Z",
      data: { skills: [] },
    });
    const olderWithSkills = row({
      id: "older",
      conversation_id: "conv-0",
      updated_at: "2026-01-01T00:00:00.000Z",
      data: { skills: [{ id: "welding", name_he: "ריתוך", source: "cv" }] },
    });

    const merged = mergeProfileRows([primary, newerUnrelated, olderWithSkills], "conv-1");

    expect(merged?.data?.skills).toEqual([{ id: "welding", name_he: "ריתוך", source: "cv" }]);
  });

  it("falls back past a null primary to the most recent non-null value, and primary non-null beats a newer row", () => {
    const primaryNull = row({
      id: "primary",
      conversation_id: "conv-1",
      updated_at: "2026-01-01T00:00:00.000Z",
      data: { interests: null },
    });
    const newer = row({
      id: "newer",
      conversation_id: "conv-2",
      updated_at: "2026-01-02T00:00:00.000Z",
      data: { interests: ["fallback"] },
    });

    const merged = mergeProfileRows([primaryNull, newer], "conv-1");
    expect(merged?.data?.interests).toEqual(["fallback"]);

    const primaryNonNull = row({
      id: "primary2",
      conversation_id: "conv-1",
      updated_at: "2026-01-01T00:00:00.000Z",
      data: { interests: ["primary-wins"] },
    });
    const newer2 = row({
      id: "newer2",
      conversation_id: "conv-2",
      updated_at: "2026-01-02T00:00:00.000Z",
      data: { interests: ["should-lose"] },
    });

    const merged2 = mergeProfileRows([primaryNonNull, newer2], "conv-1");
    expect(merged2?.data?.interests).toEqual(["primary-wins"]);
  });

  it("uses recency order when there is no primary row", () => {
    const older = row({
      id: "older",
      conversation_id: null,
      updated_at: "2026-01-01T00:00:00.000Z",
      data: { interests: ["old"] },
    });
    const newer = row({
      id: "newer",
      conversation_id: null,
      updated_at: "2026-01-02T00:00:00.000Z",
      data: { interests: ["new"] },
    });

    const merged = mergeProfileRows([older, newer], null);
    expect(merged?.data?.interests).toEqual(["new"]);

    const mergedNoMatchingPrimary = mergeProfileRows([older, newer], "conv-does-not-exist");
    expect(mergedNoMatchingPrimary?.data?.interests).toEqual(["new"]);
  });

  it("resurrects a skill removed on a later CV confirm if an older orphan row still has it (intentional tradeoff, see profile-rows.ts)", () => {
    const primaryAfterRemoval = row({
      id: "primary",
      conversation_id: "conv-1",
      updated_at: "2026-01-02T00:00:00.000Z",
      data: {
        // User re-confirmed their CV and removed "python" from this row.
        skills: [{ id: "javascript", name_he: "JavaScript", source: "cv" }],
      },
    });
    const olderOrphanStillHasRemovedSkill = row({
      id: "orphan",
      conversation_id: null,
      updated_at: "2026-01-01T00:00:00.000Z",
      data: {
        skills: [{ id: "python", name_he: "Python", source: "cv" }],
      },
    });

    const merged = mergeProfileRows(
      [primaryAfterRemoval, olderOrphanStillHasRemovedSkill],
      "conv-1",
    );

    // "python" was removed from the primary row but is unioned back in from
    // the stale orphan — this is the documented, accepted tradeoff.
    expect(merged?.data?.skills).toEqual(
      expect.arrayContaining([
        { id: "javascript", name_he: "JavaScript", source: "cv" },
        { id: "python", name_he: "Python", source: "cv" },
      ]),
    );
    expect(merged?.data?.skills).toHaveLength(2);
  });

  it("latest conversation has no linked profile row: base is the newest row by updated_at", () => {
    const olderRow = row({
      id: "older",
      conversation_id: "conv-old",
      updated_at: "2026-01-01T00:00:00.000Z",
      data: { interests: ["old-interests"], other_field: "from-older" },
    });
    const newestRow = row({
      id: "newest",
      conversation_id: "conv-also-not-latest",
      updated_at: "2026-01-03T00:00:00.000Z",
      data: { interests: ["newest-interests"], other_field: "from-newest" },
    });

    // "conv-latest" has no career_profile row at all (e.g. the user started
    // a fresh conversation but hasn't produced any profile data in it yet).
    const merged = mergeProfileRows([olderRow, newestRow], "conv-latest");

    expect(merged?.data?.interests).toEqual(["newest-interests"]);
    expect(merged?.data?.other_field).toBe("from-newest");
    expect((merged as ProfileRow).id).toBe("newest");
  });

  it("dedupes skills by id in favor of the newer row, and keeps all id-less chat skills", () => {
    const primary = row({
      id: "primary",
      conversation_id: "conv-1",
      updated_at: "2026-01-01T00:00:00.000Z",
      data: {
        skills: [
          { id: "python", name_he: "Python (old)", source: "cv" },
          { label_he: "עבודת צוות", confidence: "high" },
        ],
      },
    });
    const newerOrphan = row({
      id: "orphan",
      conversation_id: null,
      updated_at: "2026-01-02T00:00:00.000Z",
      data: {
        skills: [
          { id: "python", name_he: "Python (new)", source: "cv" },
          { label_he: "פתרון בעיות", confidence: "medium" },
          { label_he: "יצירתיות", confidence: "low" },
        ],
      },
    });

    const merged = mergeProfileRows([primary, newerOrphan], "conv-1");
    const skills = merged?.data?.skills ?? [];

    const pythonEntries = skills.filter((s) => s.id === "python");
    expect(pythonEntries).toHaveLength(1);
    expect(pythonEntries[0]?.source).toBe("cv");
    expect(pythonEntries[0]?.name_he).toBe("Python (new)");

    const idLess = skills.filter((s) => !s.id);
    expect(idLess).toHaveLength(3);
  });

  describe("per-field boundary cases", () => {
    it("an empty-but-defined primary value wins outright, without falling back", () => {
      const primary = row({
        id: "primary",
        conversation_id: "conv-1",
        updated_at: "2026-01-01T00:00:00.000Z",
        data: { interests: [], values: [], constraints: {} },
      });
      const newer = row({
        id: "newer",
        conversation_id: "conv-2",
        updated_at: "2026-01-02T00:00:00.000Z",
        data: {
          interests: ["should-not-be-used"],
          values: ["should-not-be-used"],
          constraints: { time_per_week_hours: 1 },
        },
      });

      const merged = mergeProfileRows([primary, newer], "conv-1");
      expect(merged?.data?.interests).toEqual([]);
      expect(merged?.data?.values).toEqual([]);
      expect(merged?.data?.constraints).toEqual({});
    });

    it("skips past intermediate nulls to an older row's non-null value", () => {
      const primary = row({
        id: "primary",
        conversation_id: "conv-1",
        updated_at: "2026-01-01T00:00:00.000Z",
        data: { interests: null },
      });
      const newestNonPrimary = row({
        id: "newest-non-primary",
        conversation_id: "conv-2",
        updated_at: "2026-01-03T00:00:00.000Z",
        data: { interests: null },
      });
      const olderWithValue = row({
        id: "older",
        conversation_id: "conv-3",
        updated_at: "2026-01-02T00:00:00.000Z",
        data: { interests: ["older-value"] },
      });

      const merged = mergeProfileRows([primary, newestNonPrimary, olderWithValue], "conv-1");
      expect(merged?.data?.interests).toEqual(["older-value"]);
    });
  });

  it("is deterministic regardless of input order, with id desc tiebreak on equal updated_at", () => {
    const rowA = row({
      id: "b-row",
      conversation_id: "conv-1",
      updated_at: "2026-01-01T00:00:00.000Z",
      data: { interests: ["from-a"] },
    });
    const rowB = row({
      id: "a-row",
      conversation_id: "conv-2",
      updated_at: "2026-01-01T00:00:00.000Z",
      data: { interests: ["from-b"] },
    });

    // No primary matches, so recency order (equal updated_at -> id desc) decides.
    const merged1 = mergeProfileRows([rowA, rowB], "conv-does-not-exist");
    const merged2 = mergeProfileRows([rowB, rowA], "conv-does-not-exist");

    expect(merged1).toEqual(merged2);
    expect(merged1?.data?.interests).toEqual(["from-a"]); // "b-row" > "a-row"
  });

  it("does not throw on malformed data or skills in the merge path", () => {
    const primary = row({
      id: "primary",
      conversation_id: "conv-1",
      updated_at: "2026-01-01T00:00:00.000Z",
      data: null,
    });
    const other = row({
      id: "other",
      conversation_id: null,
      updated_at: "2026-01-02T00:00:00.000Z",
      data: { skills: "x" },
    });

    expect(() => mergeProfileRows([primary, other], "conv-1")).not.toThrow();
    const merged = mergeProfileRows([primary, other], "conv-1");
    expect(merged?.data?.skills).toBeUndefined();
  });

  it("returns a malformed single row untouched by the short-circuit", () => {
    const malformed = row({ id: "solo", conversation_id: "conv-1", data: null });
    const merged = mergeProfileRows([malformed], "conv-1");
    expect(merged).toEqual(malformed);
  });

  it("formal-only profile: zero rows but a formal assessment yields formal-backed dimensions only", () => {
    expect(mergeProfileRows([], null)).toBeNull();

    const formal = {
      riasec: null,
      big5: { scores: { O: 50, C: 50, E: 50, A: 50, N: 50 } },
      values: null,
      constraints: null,
    };

    // Mirrors what the loader (step 2) does: merged === null -> { formal }.
    const loaderOutput = { formal };
    const matching = buildMatchingProfile(loaderOutput);

    expect(matching.interests).toBeNull();
    expect(matching.skills).toBeNull();
    expect(matching.values).toBeNull();
    expect(matching.constraints).toBeNull();
    expect(matching.big5).toEqual(formal.big5.scores);

    const matchingNoFormal = buildMatchingProfile({});
    expect(matchingNoFormal.big5).toBeNull();
  });
});
