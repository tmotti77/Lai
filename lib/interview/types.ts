export const PERSONA_IDS = ["hr", "technical", "first_job"] as const;
export type PersonaId = (typeof PERSONA_IDS)[number];

export interface Persona {
  id: PersonaId;
  label_he: string;
  description_he: string;
  system_prompt_overlay: string;
}

export interface InterviewSession {
  id: string;
  user_id: string;
  persona: PersonaId;
  target_occupation_id: string | null;
  target_role_he: string;
  question_count: number;
  max_questions: number;
  completed_at: string | null;
  feedback_summary_he: string | null;
  feedback_per_question: Array<{ question_number: number; note_he: string }> | null;
  feedback_strengths_he: string[] | null;
  feedback_improvements_he: string[] | null;
  feedback_next_practice_focus_he: string | null;
  forced_wrap: boolean;
  created_at: string;
}

export interface InterviewMessageRow {
  id: string;
  session_id: string;
  role: "user" | "assistant" | "system";
  content: string;
  safety_flag: string | null;
  cache_read_tokens: number | null;
  cache_write_tokens: number | null;
  created_at: string;
}

export interface WrapUpPayload {
  summary_he: string;
  strengths_he: string[];
  improvements_he: string[];
  next_practice_focus_he: string;
  per_question: Array<{ question_number: number; note_he: string }>;
}
