import "server-only";
import { after } from "next/server";
import { track as vercelTrack } from "@vercel/analytics/server";

export type EventName =
  | "conversation_started"
  | "assessment_completed"
  | "cv_uploaded"
  | "recommendations_generated"
  | "report_downloaded"
  | "plan_generated"
  | "plan_task_completed"
  | "interview_started"
  | "interview_completed"
  | "feedback_submitted";

export type SkillCountBucket = "0-5" | "6-10" | "11-20" | "20+";
export type CvArchetype = "builder" | "connector" | "analyst" | "leader" | "creator" | "generalist";
export type PlanArchetype = "apply" | "taste_test" | "research";
export type PlanTaskCategory = "action" | "research" | "network" | "reflection";
export type InterviewPersona = "hr" | "technical" | "first_job";
export type NpsTrigger = "pdf_download" | "plan_generated" | "interview_completed";
export type NpsBucket = "detractor" | "passive" | "promoter";
export type QuestionCountBucket = "1-4" | "5-8" | "9+";

export type EventPropsMap = {
  conversation_started: { surface: "chat" | "interview" };
  assessment_completed: { type: "riasec" | "big5" | "values" | "constraints" };
  cv_uploaded: { skill_count_bucket: SkillCountBucket; archetype: CvArchetype };
  recommendations_generated: { cache_hit: boolean; dimension_count: 0 | 1 | 2 | 3 | 4 | 5 | 6 };
  report_downloaded: { is_first: boolean };
  plan_generated: { archetype: PlanArchetype };
  plan_task_completed: { category: PlanTaskCategory; week: 1 | 2 | 3 | 4 | 5 };
  interview_started: { persona: InterviewPersona };
  interview_completed: {
    persona: InterviewPersona;
    forced_wrap: boolean;
    question_count_bucket: QuestionCountBucket;
  };
  feedback_submitted:
    | { kind: "thumb"; surface: "chat" | "recommendations" | "interview"; value: "up" | "down" | "removed" }
    | { kind: "nps"; trigger: NpsTrigger; bucket: NpsBucket };
};

export function track<E extends EventName>(event: E, props: EventPropsMap[E]): void {
  if (process.env.NODE_ENV === "test") return;
  after(() => {
    vercelTrack(event, props as Record<string, string | number | boolean | null>).catch((err) => {
      console.error(`[analytics] track(${event}) failed:`, err);
    });
  });
}

export function npsBucket(score: number): NpsBucket {
  if (score <= 6) return "detractor";
  if (score <= 8) return "passive";
  return "promoter";
}

export function questionCountBucket(count: number): QuestionCountBucket {
  if (count <= 4) return "1-4";
  if (count <= 8) return "5-8";
  return "9+";
}

export function skillCountBucket(count: number): SkillCountBucket {
  if (count <= 5) return "0-5";
  if (count <= 10) return "6-10";
  if (count <= 20) return "11-20";
  return "20+";
}
