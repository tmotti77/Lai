import type { Ranking, Paths, Occupation, MatchingProfile } from "@/lib/matching/types";

export type ReportData = {
  generatedAt: string;
  userDisplayName: string | null;
  profile: MatchingProfile;
  profileSummaryHe: string | null;
  rankings: Ranking[];
  paths: Paths;
  prose: Record<string, string>;
  occupations: Occupation[];
};
