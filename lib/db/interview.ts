import "server-only";
import { createServiceClient } from "@/lib/supabase/service";
import type {
  InterviewSession,
  InterviewMessageRow,
  PersonaId,
  WrapUpPayload,
} from "@/lib/interview/types";

export async function createInterviewSession(input: {
  userId: string;
  persona: PersonaId;
  targetOccupationId: string | null;
  targetRoleHe: string;
  maxQuestions?: number;
}): Promise<{ id: string }> {
  const supa = createServiceClient();
  const { data, error } = await supa
    .from("interview_sessions")
    .insert({
      user_id: input.userId,
      persona: input.persona,
      target_occupation_id: input.targetOccupationId,
      target_role_he: input.targetRoleHe,
      max_questions: input.maxQuestions ?? 8,
    })
    .select("id")
    .single();
  if (error) throw new Error(`createInterviewSession: ${error.message}`);
  return { id: data.id as string };
}

export async function getInterviewSession(
  sessionId: string,
): Promise<InterviewSession | null> {
  const supa = createServiceClient();
  const { data, error } = await supa
    .from("interview_sessions")
    .select("*")
    .eq("id", sessionId)
    .maybeSingle();
  if (error) throw new Error(`getInterviewSession: ${error.message}`);
  return (data as InterviewSession | null) ?? null;
}

export async function listSessionsForUser(
  userId: string,
  limit = 5,
): Promise<InterviewSession[]> {
  const supa = createServiceClient();
  const { data, error } = await supa
    .from("interview_sessions")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(`listSessionsForUser: ${error.message}`);
  return (data as InterviewSession[]) ?? [];
}

export async function loadInterviewMessages(
  sessionId: string,
): Promise<InterviewMessageRow[]> {
  const supa = createServiceClient();
  const { data, error } = await supa
    .from("interview_messages")
    .select("*")
    .eq("session_id", sessionId)
    .order("created_at", { ascending: true });
  if (error) throw new Error(`loadInterviewMessages: ${error.message}`);
  return (data as InterviewMessageRow[]) ?? [];
}

export async function appendInterviewMessage(input: {
  sessionId: string;
  role: "user" | "assistant" | "system";
  content: string;
  safetyFlag?: string;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
}): Promise<void> {
  const supa = createServiceClient();
  const { error } = await supa.from("interview_messages").insert({
    session_id: input.sessionId,
    role: input.role,
    content: input.content,
    safety_flag: input.safetyFlag ?? null,
    cache_read_tokens: input.cacheReadTokens ?? null,
    cache_write_tokens: input.cacheWriteTokens ?? null,
  });
  if (error) throw new Error(`appendInterviewMessage: ${error.message}`);
}

export async function incrementQuestionCount(sessionId: string): Promise<number> {
  const supa = createServiceClient();
  const { data: current, error: readErr } = await supa
    .from("interview_sessions")
    .select("question_count")
    .eq("id", sessionId)
    .single();
  if (readErr) throw new Error(`incrementQuestionCount: ${readErr.message}`);
  const next = (current.question_count as number) + 1;
  const { error } = await supa
    .from("interview_sessions")
    .update({ question_count: next })
    .eq("id", sessionId);
  if (error) throw new Error(`incrementQuestionCount update: ${error.message}`);
  return next;
}

export async function completeInterviewSession(
  sessionId: string,
  payload: WrapUpPayload & { forcedWrap?: boolean },
): Promise<void> {
  const supa = createServiceClient();
  const { error } = await supa
    .from("interview_sessions")
    .update({
      completed_at: new Date().toISOString(),
      feedback_summary_he: payload.summary_he,
      feedback_strengths_he: payload.strengths_he,
      feedback_improvements_he: payload.improvements_he,
      feedback_next_practice_focus_he: payload.next_practice_focus_he,
      feedback_per_question: payload.per_question,
      forced_wrap: payload.forcedWrap ?? false,
    })
    .eq("id", sessionId);
  if (error) throw new Error(`completeInterviewSession: ${error.message}`);
}
