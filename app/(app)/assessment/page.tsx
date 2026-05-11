import { createClient } from "@/lib/supabase/server";
import { getOrCreateAnonymousUserId } from "@/lib/anonymous";
import { getStatus } from "@/lib/db/assessments";
import { AssessmentHub } from "@/components/assessment/AssessmentHub";

export const dynamic = "force-dynamic";

export default async function AssessmentPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const internalUserId = await getOrCreateAnonymousUserId(user?.id);
  const status = await getStatus(internalUserId);
  return <AssessmentHub status={status} />;
}
