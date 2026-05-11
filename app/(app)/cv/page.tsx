import { createClient } from "@/lib/supabase/server";
import { getOrCreateAnonymousUserId } from "@/lib/anonymous";
import { getLatestCvForUser } from "@/lib/db/cv";
import { CvUploadClient } from "@/components/cv/CvUploadClient";

export const dynamic = "force-dynamic";

export default async function CvPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const userId = await getOrCreateAnonymousUserId(user?.id);
  const existing = await getLatestCvForUser(userId);

  const initial = existing
    ? {
        id: existing.id,
        filename: existing.original_filename,
        confirmed: existing.confirmed_at !== null,
        reflectionHe: existing.reflection_he ?? "",
        taxonomySkills: existing.extracted_skills.taxonomy,
        otherSkills: existing.extracted_skills.other,
      }
    : null;

  return <CvUploadClient initial={initial} />;
}
