import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { getOrCreateAnonymousUserId } from "@/lib/anonymous";
import { getCvUploadForUser, confirmCvUpload } from "@/lib/db/cv";
import type { ProfileSkill, SkillSource } from "@/lib/cv/types";
import taxonomyJson from "@/content/skills/taxonomy.json";
import { requireConsent, NoConsentError } from "@/lib/consent";

// ---------------------------------------------------------------------------
// Exported helper (also used by tests)
// ---------------------------------------------------------------------------

/**
 * Reads the LATEST career_profile row for the user (ordered by updated_at desc),
 * applies the first-CV-confirm archive rule, then updates ONLY that specific row
 * by its id — not every row for the user.
 *
 * If no profile row exists yet, inserts a new one.
 */
export async function mergeCvSkillsIntoLatestProfile(
  userId: string,
  skills: Array<{ id: string; name_he: string; source: SkillSource; evidence?: string }>,
): Promise<void> {
  const svc = createServiceClient();

  const { data: profile, error: readErr } = await svc
    .from("career_profile")
    .select("id, data")
    .eq("user_id", userId)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (readErr) throw new Error(`mergeCvSkillsIntoLatestProfile read: ${readErr.message}`);

  if (!profile) {
    // No profile yet — insert. conversation_id is unknown at this point; leave null.
    const { error: insErr } = await svc.from("career_profile").insert({
      user_id: userId,
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .update({ data: mergedData as any })
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

  try {
    await confirmCvUpload({ id: upload.id, userId });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: "confirm_failed", message }, { status: 500 });
  }

  return Response.json({ ok: true, skill_count: confirmedSkills.length });
}
