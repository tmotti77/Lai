export type SkillSource = "cv" | "chat" | "manual";

export type ProfileSkill = {
  id: string;
  name_he: string;
  source: SkillSource;
  evidence?: string;
};

export type ExtractedSkill = {
  id: string;
  confidence: number;
  evidence: string;
};

export type CvExtraction = {
  reflection_he: string;
  skills: ExtractedSkill[];
  other_skills: string[];
};

export type CvUpload = {
  id: string;
  user_id: string;
  storage_path: string;
  original_filename: string;
  mime_type: string;
  size_bytes: number;
  extracted_text: string | null;
  reflection_he: string | null;
  extracted_skills: { taxonomy: ExtractedSkill[]; other: string[] };
  confirmed_at: string | null;
  created_at: string;
};

export const ACCEPTED_MIME_TYPES = [
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
] as const;

export const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;
export const MAX_EXTRACTED_TEXT_CHARS = 50_000;
