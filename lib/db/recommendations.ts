import "server-only";
import { createServiceClient } from "@/lib/supabase/service";
import type { RecommendationResult } from "@/lib/matching/types";

const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export type CachedRecommendation = {
  rankings: RecommendationResult["rankings"];
  paths: RecommendationResult["paths"];
  prose: Record<string, string>;
  generatedAt: string;
};

export async function getCached(
  userId: string,
  profileHash: string,
): Promise<CachedRecommendation | null> {
  const svc = createServiceClient();
  const { data, error } = await svc
    .from("recommendations")
    .select("rankings, paths, prose, generated_at")
    .eq("user_id", userId)
    .eq("profile_hash", profileHash)
    .order("generated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;

  const ageMs = Date.now() - new Date(data.generated_at).getTime();
  if (ageMs > CACHE_TTL_MS) return null;

  return {
    rankings: data.rankings as never,
    paths: data.paths as never,
    prose: data.prose as never,
    generatedAt: data.generated_at,
  };
}

export async function saveRecommendation(args: {
  userId: string;
  profileHash: string;
  rankings: RecommendationResult["rankings"];
  paths: RecommendationResult["paths"];
  prose: Record<string, string>;
}): Promise<void> {
  const svc = createServiceClient();
  const { error } = await svc.from("recommendations").insert({
    user_id: args.userId,
    profile_hash: args.profileHash,
    rankings: args.rankings as never,
    paths: args.paths as never,
    prose: args.prose as never,
  });
  if (error) throw error;
}
