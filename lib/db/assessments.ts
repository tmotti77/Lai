import "server-only";
import { createServiceClient } from "@/lib/supabase/service";
import type { Database } from "@/lib/db/types.gen";

type AssessmentType = Database["public"]["Enums"]["assessment_type"];

export type AssessmentStatus = "not_started" | "completed";

export type AssessmentStatusMap = Record<AssessmentType, AssessmentStatus>;

export async function saveAssessment(args: {
  userId: string;
  type: AssessmentType;
  responses: unknown;
  scores: unknown;
  itemsVersion: number;
}): Promise<{ id: string; takenAt: string }> {
  const svc = createServiceClient();
  const { data, error } = await svc
    .from("assessments")
    .insert({
      user_id: args.userId,
      type: args.type,
      responses: args.responses as never,
      scores: args.scores as never,
      items_version: args.itemsVersion,
    })
    .select("id, taken_at")
    .single();
  if (error) throw error;
  return { id: data.id, takenAt: data.taken_at };
}

export async function getLatestByType(
  userId: string,
): Promise<Record<AssessmentType, { scores: unknown; takenAt: string; itemsVersion: number } | null>> {
  const svc = createServiceClient();
  const { data, error } = await svc
    .from("assessments")
    .select("type, scores, taken_at, items_version")
    .eq("user_id", userId)
    .order("taken_at", { ascending: false });
  if (error) throw error;

  const result: Record<string, { scores: unknown; takenAt: string; itemsVersion: number } | null> = {
    riasec: null, big5: null, values: null, constraints: null,
  };
  for (const row of data ?? []) {
    if (result[row.type] == null) {
      result[row.type] = {
        scores: row.scores,
        takenAt: row.taken_at,
        itemsVersion: row.items_version,
      };
    }
  }
  return result as Record<AssessmentType, { scores: unknown; takenAt: string; itemsVersion: number } | null>;
}

export async function getStatus(userId: string): Promise<AssessmentStatusMap> {
  const latest = await getLatestByType(userId);
  return {
    riasec: latest.riasec ? "completed" : "not_started",
    big5: latest.big5 ? "completed" : "not_started",
    values: latest.values ? "completed" : "not_started",
    constraints: latest.constraints ? "completed" : "not_started",
  };
}
