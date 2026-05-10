import type { MatchingProfile, Occupation, Big5Vector } from "../types";

/**
 * For each Big5 trait the occupation has a preference for, compute |user - preference|
 * and convert to similarity (100 - distance). Average across present preferences.
 *
 * If the occupation has no big5_fit at all, it has no preference — return 100
 * (no constraint = perfect fit). Returns null when user has no big5 signal.
 */
export function scoreBig5(profile: MatchingProfile, occupation: Occupation): number | null {
  if (!profile.big5) return null;
  if (!occupation.big5_fit) return 100;

  const traits: (keyof Big5Vector)[] = ["O", "C", "E", "A", "N"];
  const present = traits.filter((t) => occupation.big5_fit?.[t] !== undefined);
  if (present.length === 0) return 100;

  let totalSim = 0;
  for (const t of present) {
    const userVal = profile.big5[t];
    const occVal = occupation.big5_fit[t]!;
    const distance = Math.abs(userVal - occVal);
    totalSim += 100 - distance;
  }
  return Math.round(totalSim / present.length);
}
