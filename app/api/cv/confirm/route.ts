import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { getOrCreateAnonymousUserId } from "@/lib/anonymous";
import { getCvUploadForUser, confirmCvUpload } from "@/lib/db/cv";
import type { ProfileSkill, SkillSource } from "@/lib/cv/types";
import type { Json } from "@/lib/db/types.gen";
import taxonomyJson from "@/content/skills/taxonomy.json";
import { requireConsent, NoConsentError } from "@/lib/consent";
import { track, skillCountBucket } from "@/lib/analytics";
import { inferArchetype } from "@/lib/cv/archetype";
import { invalidateUserRecommendations } from "@/lib/db/recommendations";

// ---------------------------------------------------------------------------
// Exported helper (also used by tests)
// ---------------------------------------------------------------------------

/**
 * Reads the profile row for the user's latest conversation (if one exists),
 * applies the first-CV-confirm archive rule, then updates ONLY that specific row
 * by its id — not every row for the user.
 *
 * **FIX**: This function now looks up the latest conversation and merges CV skills
 * into the SAME profile row that chat extraction writes to. Previously it only
 * looked up by updated_at, which could target a different profile row, causing
 * recommendations to show empty data even after CV upload.
 *
 * If no conversation exists, falls back to the latest profile row by updated_at.
 * If no profile row exists yet, inserts a new one.
 */
export async function mergeCvSkillsIntoLatestProfile(
  userId: string,
  skills: Array<{ id: string; name_he: string; source: SkillSource; evidence?: string }>,
): Promise<void> {
  const svc = createServiceClient();

  // First, try to find the profile linked to the user's latest conversation.
  // This ensures CV skills merge with chat-extracted data in the same row.
  const { data: convs } = await svc
    .from("conversations")
    .select("id")
    .eq("user_id", userId)
    .order("updated_at", { ascending: false })
    .limit(1);
  const latestConversationId = convs?.[0]?.id;

  let profile: { id: string; data: unknown } | null = null;
  let readErr: unknown = null;

  if (latestConversationId) {
    const { data, error } = await svc
      .from("career_profile")
      .select("id, data")
      .eq("user_id", userId)
      .eq("conversation_id", latestConversationId)
      .maybeSingle();
    profile = data;
    readErr = error;
  }

  // Fall back to latest profile by updated_at if no conversation profile exists
  if (!profile) {
    const { data, error } = await svc
      .from("career_profile")
      .select("id, data")
      .eq("user_id", userId)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    profile = data;
    readErr = error;
  }

  if (readErr) throw new Error(`mergeCvSkillsIntoLatestProfile read: ${(readErr as { message: string }).message}`);

  if (!profile) {
    // No profile yet — insert. Link to latest conversation if one exists.
    const { error: insErr } = await svc.from("career_profile").insert({
      user_id: userId,
      conversation_id: latestConversationId ?? null,
      data: { skills, skills_from_chat: [] },
    });
    if (insErr) throw new Error(`mergeCvSkillsIntoLatestProfile insert: ${insErr.message}`);
    return;
  }

  const existing = (profile.data ?? {}) as {
    skills?: unknown[];
    skills_from_chat?: unknown[];
    [key: string]: unknown;
  };

  // First-CV-confirm rule: if skills_from_chat is unset AND chat skills exist,
  // archive them before replacing with CV skills.
  const archive =
    existing.skills_from_chat === undefined &&
    Array.isArray(existing.skills) &&
    existing.skills.length > 0
      ? existing.skills
      : (existing.skills_from_chat ?? []);

  const mergedData = {
    ...existing,
    skills,
    skills_from_chat: archive,
  };

  const { error: updErr } = await svc
    .from("career_profile")
    .update({ data: mergedData as unknown as Json })
    .eq("id", profile.id); // ← scoped to THIS row, not all user rows
  if (updErr) throw new Error(`mergeCvSkillsIntoLatestProfile update: ${updErr.message}`);
}

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

  try {
    await requireConsent(userId);
  } catch (e) {
    if (e instanceof NoConsentError) {
      return Response.json({ error: "no_consent" }, { status: 403 });
    }
    throw e;
  }

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

  try {
    await mergeCvSkillsIntoLatestProfile(userId, confirmedSkills);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: "profile_update_failed", message }, { status: 500 });
  }

  // Invalidate cached recommendations so the user sees fresh matches
  // reflecting their newly confirmed CV skills on next /recommendations visit.
  try {
    await invalidateUserRecommendations(userId);
  } catch (err) {
    // Log but don't block — cache invalidation failure shouldn't prevent CV confirm.
    console.error("[cv/confirm] failed to invalidate recommendations cache", err);
  }

  const skillCategories = confirmedSkills
    .map((s) => TAXONOMY.get(s.id)?.category)
    .filter((c): c is string => c !== undefined);
  const archetype = inferArchetype(skillCategories);
  track("cv_uploaded", {
    skill_count_bucket: skillCountBucket(confirmedSkills.length),
    archetype,
  });

  try {
    await confirmCvUpload({ id: upload.id, userId });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: "confirm_failed", message }, { status: 500 });
  }

  return Response.json({ ok: true, skill_count: confirmedSkills.length });
}
