/**
 * Pure merge of a user's career_profile rows into one profile object for
 * buildMatchingProfile. No I/O — the DB loader (lib/db/profile.ts) reads all
 * rows and the latest conversation id, then hands them here.
 *
 * Precedence (see docs/plans/61-profile-loader-all-rows.md "Merge rules"):
 *  - 0 rows -> null.
 *  - 1 row -> that row, untouched (no dedupe, no reordering).
 *  - 2+ rows:
 *    - interests/values/constraints, each independently: the primary row's
 *      value (the row linked to the latest conversation) if it is non-null;
 *      otherwise the first non-null value found walking all rows in recency
 *      order (updated_at desc, id desc tiebreak). An empty array/object is a
 *      defined value, not a missing one, so it does not fall through.
 *    - skills: concatenate every row's skills array in recency order.
 *      Skills with an `id` keep only the first (newest) occurrence of that
 *      id; skills without an `id` (chat extraction) are never deduped.
 *      Empty union -> `skills: undefined`.
 *      NOTE (intentional, not a bug): this union is across ALL rows, not just
 *      the primary row. If a skill is removed on a later CV confirm (it only
 *      lives in the primary row's `skills` array, having been dropped there),
 *      but an older orphan row still lists that skill by `id`, the union
 *      resurrects it. We accept this tradeoff in favor of never losing a
 *      skill a user once confirmed; see the pinned test
 *      "resurrects a skill removed on a later CV confirm if an older orphan
 *      row still has it" in tests/unit/matching/profile-rows.test.ts.
 *    - every other `data` key, and all row-level metadata: taken as-is from
 *      the primary row if one exists, else the newest row.
 *  - Malformed `data` (non-object) or `skills` (non-array) on any row inside
 *    the 2+-row path is treated as `{}` / `[]` rather than throwing. This
 *    does not apply to the 1-row short-circuit, which returns the row as-is.
 */

export type ProfileSkill = {
  id?: string;
  [key: string]: unknown;
};

export type ProfileData = {
  interests?: unknown;
  values?: unknown;
  constraints?: unknown;
  skills?: ProfileSkill[];
  [key: string]: unknown;
};

export type ProfileRow = {
  id: string;
  conversation_id: string | null;
  updated_at: string;
  data: unknown;
  [key: string]: unknown;
};

export type MergedProfile = {
  data?: ProfileData;
  [key: string]: unknown;
};

type ScalarField = "interests" | "values" | "constraints";

function asProfileData(data: unknown): ProfileData {
  if (data && typeof data === "object" && !Array.isArray(data)) {
    return data as ProfileData;
  }
  return {};
}

function sortByRecency(rows: ProfileRow[]): ProfileRow[] {
  return [...rows].sort((a, b) => {
    const diff = new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();
    if (diff !== 0) return diff;
    if (a.id === b.id) return 0;
    // Equal updated_at: id desc, matching the #60 migration's tiebreak.
    return a.id < b.id ? 1 : -1;
  });
}

export function mergeProfileRows(
  rows: ProfileRow[],
  latestConversationId: string | null,
): MergedProfile | null {
  if (rows.length === 0) return null;
  if (rows.length === 1) return { ...rows[0] } as MergedProfile;

  const sorted = sortByRecency(rows);
  const primary = latestConversationId
    ? rows.find((row) => row.conversation_id === latestConversationId) ?? null
    : null;
  const baseRow = primary ?? sorted[0];

  function fieldValue(field: ScalarField): unknown {
    if (primary) {
      const value = asProfileData(primary.data)[field];
      if (value !== null && value !== undefined) return value;
    }
    for (const row of sorted) {
      const value = asProfileData(row.data)[field];
      if (value !== null && value !== undefined) return value;
    }
    return undefined;
  }

  function mergeSkills(): ProfileSkill[] | undefined {
    const seenIds = new Set<string>();
    const merged: ProfileSkill[] = [];
    for (const row of sorted) {
      const skills = asProfileData(row.data).skills;
      const list = Array.isArray(skills) ? skills : [];
      for (const skill of list) {
        if (!skill || typeof skill !== "object") continue;
        const id = (skill as ProfileSkill).id;
        if (id) {
          if (seenIds.has(id)) continue;
          seenIds.add(id);
        }
        merged.push(skill as ProfileSkill);
      }
    }
    return merged.length > 0 ? merged : undefined;
  }

  const mergedData: ProfileData = {
    ...asProfileData(baseRow.data),
    interests: fieldValue("interests"),
    values: fieldValue("values"),
    constraints: fieldValue("constraints"),
    skills: mergeSkills(),
  };

  return { ...baseRow, data: mergedData };
}
