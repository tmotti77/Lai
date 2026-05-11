import { VALUES_OPTIONS, VALUES_OPTIONS_VERSION } from "./options";
import type { ValuesSubmission, ValuesScores } from "./types";

export function validateValuesSubmission(
  submission: ValuesSubmission,
  version: number,
): void {
  if (version !== VALUES_OPTIONS_VERSION) {
    throw new Error(
      `Unsupported values version: ${version} (current: ${VALUES_OPTIONS_VERSION})`,
    );
  }

  const validIds = new Set(VALUES_OPTIONS.map((o) => o.id));
  const { picked, ranked } = submission;

  if (picked.length !== 5) {
    throw new Error(`picked must be exactly 5 items, got ${picked.length}`);
  }
  if (new Set(picked).size !== 5) {
    throw new Error("picked has duplicates");
  }
  for (const id of picked) {
    if (!validIds.has(id)) throw new Error(`unknown value id: ${id}`);
  }

  if (ranked.length !== 3) {
    throw new Error(`ranked must be exactly 3 items, got ${ranked.length}`);
  }
  if (new Set(ranked).size !== 3) {
    throw new Error("ranked has duplicates");
  }
  const pickedSet = new Set(picked);
  for (const id of ranked) {
    if (!pickedSet.has(id)) throw new Error(`ranked must be subset of picked: ${id}`);
  }
}

export function scoreValues(submission: ValuesSubmission, version: number): ValuesScores {
  validateValuesSubmission(submission, version);
  const rankedSet = new Set(submission.ranked);
  return {
    topThree: [...submission.ranked],
    alsoPicked: submission.picked.filter((id) => !rankedSet.has(id)),
  };
}
