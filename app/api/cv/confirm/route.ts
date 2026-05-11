import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { getOrCreateAnonymousUserId } from "@/lib/anonymous";
import { getCvUploadForUser, confirmCvUpload } from "@/lib/db/cv";
import type { ProfileSkill } from "@/lib/cv/types";
import taxonomyJson from "@/content/skills/taxonomy.json";

export const runtime = "nodejs";
export const maxDuration = 30;

const RequestSchema = z.object({
  cv_upload_id: z.uuid(),
  skill_ids: z.array(z.string()),
});

type TaxonomyEntry = {
  id: string;
  name_he: string;
  category: string;
};
const TAXONOMY = new Map<string, TaxonomyEntry>(
  (taxonomyJson as { skills: TaxonomyEntry[] }).skills.map((s) => [s.id, s]),
);

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }

  const parsed = RequestSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "validation_failed" }, { status: 400 });
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const userId = await getOrCreateAnonymousUserId(user?.id);

  const upload = await getCvUploadForUser({
    id: parsed.data.cv_upload_id,
    userId,
  });
  if (!upload) {
    return Response.json({ error: "upload_not_found" }, { status: 404 });
  }

  // Build the confirmed skill list. Each id is either a taxonomy id or
  // "other:<phrase>" — we hydrate name_he from the taxonomy for the former
  // so Phase 4's substring scorer keeps working unchanged.
  const evidenceById = new Map(
    upload.extracted_skills.taxonomy.map((s) => [s.id, s.evidence]),
  );

  const confirmedSkills: ProfileSkill[] = parsed.data.skill_ids
    .map((id): ProfileSkill | null => {
      if (id.startsWith("other:")) {
        const phrase = id.slice("other:".length).trim();
        if (!phrase) return null;
        return {
          id,
          name_he: phrase,
          source: "cv",
          evidence: evidenceById.get(id),
        };
      }
      const entry = TAXONOMY.get(id);
      if (!entry) return null;
      return {
        id,
        name_he: entry.name_he,
        source: "cv",
        evidence: evidenceById.get(id),
      };
    })
    .filter((s): s is ProfileSkill => s !== null);

  const svc = createServiceClient();

  // Latest conversation_id, if any, for the merge_career_profile call signature.
  // CV confirms can happen pre-chat too; in that case we just upsert without it.
  const { data: convs } = await svc
    .from("conversations")
    .select("id")
    .eq("user_id", userId)
    .order("updated_at", { ascending: false })
    .limit(1);
  const conversationId = convs?.[0]?.id ?? null;

  // Fetch current profile to archive existing chat skills on FIRST CV confirm.
  const { data: existingProfile } = await svc
    .from("career_profile")
    .select("data")
    .eq("user_id", userId)
    .maybeSingle();

  const existingData = (existingProfile?.data ?? {}) as Record<string, unknown>;
  const prevSkills = Array.isArray(existingData.skills)
    ? (existingData.skills as unknown[])
    : [];
  const alreadyArchived = Array.isArray(existingData.skills_from_chat);

  // First-CV-confirm: archive previous chat skills. Subsequent confirms just
  // replace .skills — the latest CV is the source of truth.
  const archive =
    !alreadyArchived && prevSkills.length > 0
      ? { skills_from_chat: prevSkills }
      : {};

  const newData = {
    ...existingData,
    ...archive,
    skills: confirmedSkills as never,
  };

  // Direct upsert — same pattern as the merge RPC but without merging existing
  // .skills (we're explicitly replacing it).
  if (existingProfile) {
    const { error } = await svc
      .from("career_profile")
      .update({ data: newData as never, conversation_id: conversationId })
      .eq("user_id", userId);
    if (error) {
      return Response.json({ error: "profile_update_failed", message: error.message }, { status: 500 });
    }
  } else {
    const { error } = await svc
      .from("career_profile")
      .insert({ user_id: userId, data: newData as never, conversation_id: conversationId });
    if (error) {
      return Response.json({ error: "profile_insert_failed", message: error.message }, { status: 500 });
    }
  }

  try {
    await confirmCvUpload({ id: upload.id, userId });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: "confirm_failed", message }, { status: 500 });
  }

  return Response.json({ ok: true, skill_count: confirmedSkills.length });
}
