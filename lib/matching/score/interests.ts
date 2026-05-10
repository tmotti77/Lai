import type { MatchingProfile, Occupation } from "../types";

/**
 * Cosine similarity between user's RIASEC vector and occupation's RIASEC affinity,
 * scaled to 0..100. Returns null when user has no RIASEC signal.
 */
export function scoreInterests(profile: MatchingProfile, occupation: Occupation): number | null {
  if (!profile.interests) return null;

  const u = profile.interests;
  const o = occupation.riasec_affinity;

  const dot = u.R * o.R + u.I * o.I + u.A * o.A + u.S * o.S + u.E * o.E + u.C * o.C;
  const uMag = Math.sqrt(u.R*u.R + u.I*u.I + u.A*u.A + u.S*u.S + u.E*u.E + u.C*u.C);
  const oMag = Math.sqrt(o.R*o.R + o.I*o.I + o.A*o.A + o.S*o.S + o.E*o.E + o.C*o.C);

  if (uMag === 0 || oMag === 0) return 0;

  const cosine = dot / (uMag * oMag);  // 0..1 since all values are non-negative
  return Math.round(cosine * 100);
}
