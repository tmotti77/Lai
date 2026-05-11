import "server-only";
import { createServiceClient } from "@/lib/supabase/service";
import type { CvUpload, ExtractedSkill } from "@/lib/cv/types";

export async function createCvUpload(args: {
  userId: string;
  storagePath: string;
  originalFilename: string;
  mimeType: string;
  sizeBytes: number;
}): Promise<{ id: string }> {
  const svc = createServiceClient();
  const { data, error } = await svc
    .from("cv_uploads")
    .insert({
      user_id: args.userId,
      storage_path: args.storagePath,
      original_filename: args.originalFilename,
      mime_type: args.mimeType,
      size_bytes: args.sizeBytes,
    })
    .select("id")
    .single();
  if (error) throw error;
  return { id: data.id };
}

export async function setExtraction(args: {
  id: string;
  extractedText: string;
  reflectionHe: string;
  taxonomySkills: ExtractedSkill[];
  otherSkills: string[];
}): Promise<void> {
  const svc = createServiceClient();
  const { error } = await svc
    .from("cv_uploads")
    .update({
      extracted_text: args.extractedText,
      reflection_he: args.reflectionHe,
      extracted_skills: {
        taxonomy: args.taxonomySkills,
        other: args.otherSkills,
      } as never,
    })
    .eq("id", args.id);
  if (error) throw error;
}

export async function confirmCvUpload(args: {
  id: string;
  userId: string;
}): Promise<void> {
  const svc = createServiceClient();
  const { error } = await svc
    .from("cv_uploads")
    .update({ confirmed_at: new Date().toISOString() })
    .eq("id", args.id)
    .eq("user_id", args.userId);
  if (error) throw error;
}

export async function getLatestCvForUser(userId: string): Promise<CvUpload | null> {
  const svc = createServiceClient();
  const { data, error } = await svc
    .from("cv_uploads")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return {
    ...data,
    extracted_skills: (data.extracted_skills ?? { taxonomy: [], other: [] }) as {
      taxonomy: ExtractedSkill[];
      other: string[];
    },
  } as CvUpload;
}

export async function getCvUploadForUser(args: {
  id: string;
  userId: string;
}): Promise<CvUpload | null> {
  const svc = createServiceClient();
  const { data, error } = await svc
    .from("cv_uploads")
    .select("*")
    .eq("id", args.id)
    .eq("user_id", args.userId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return {
    ...data,
    extracted_skills: (data.extracted_skills ?? { taxonomy: [], other: [] }) as {
      taxonomy: ExtractedSkill[];
      other: string[];
    },
  } as CvUpload;
}
