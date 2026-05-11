import "server-only";
import type { MatchingProfile, RiasecVector, Big5Vector } from "./types";

type RawProfile = {
  data?: {
    interests?: { label_he: string; confidence?: string }[];
    skills?: { label_he: string; confidence?: string }[];
    values?: string[];
    constraints?: Record<string, unknown>;
    summary_he?: string;
  };
  formal?: {
    riasec: { scores: { R: number; I: number; A: number; S: number; E: number; C: number } } | null;
    big5: { scores: { O: number; C: number; E: number; A: number; N: number } } | null;
    values: { scores: { topThree: string[]; alsoPicked: string[] } } | null;
    constraints: { scores: Record<string, unknown> } | null;
  };
} | null;

const CONFIDENCE_TO_LEVEL: Record<string, number> = {
  high: 1.0,
  medium: 0.6,
  low: 0.3,
};

export function buildMatchingProfile(raw: RawProfile): MatchingProfile {
  const profile: MatchingProfile = {
    interests: null,
    skills: null,
    values: null,
    big5: null,
    constraints: null,
  };

  const formalRiasec = raw?.formal?.riasec?.scores;
  if (formalRiasec) {
    profile.interests = formalRiasec as RiasecVector;
  }

  const formalBig5 = raw?.formal?.big5?.scores;
  if (formalBig5) {
    profile.big5 = formalBig5 as Big5Vector;
  }

  const formalValues = raw?.formal?.values?.scores;
  if (formalValues) {
    profile.values = formalValues as { topThree: string[]; alsoPicked: string[] };
  } else if (raw?.data?.values && raw.data.values.length > 0) {
    const vals = raw.data.values;
    profile.values = {
      topThree: vals.slice(0, 3),
      alsoPicked: vals.slice(3, 5),
    };
  }

  const formalConstraints = raw?.formal?.constraints?.scores;
  if (formalConstraints) {
    profile.constraints = formalConstraints as MatchingProfile["constraints"];
  } else if (raw?.data?.constraints) {
    profile.constraints = raw.data.constraints as MatchingProfile["constraints"];
  }

  if (raw?.data?.skills && raw.data.skills.length > 0) {
    profile.skills = raw.data.skills.map((s) => ({
      id: s.label_he,
      level: CONFIDENCE_TO_LEVEL[s.confidence ?? "medium"] ?? 0.6,
    }));
  }

  return profile;
}
