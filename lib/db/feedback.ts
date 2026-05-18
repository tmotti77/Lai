import "server-only";
import { createServiceClient } from "@/lib/supabase/service";

export async function getUserFeedbackForTargets(
  userId: string,
  targets: Array<{ type: string; id: string }>
): Promise<Map<string, -1 | 1>> {
  if (targets.length === 0) return new Map();
  const supabase = createServiceClient();
  const types = [...new Set(targets.map((t) => t.type))];
  const ids = targets.map((t) => t.id);
  const { data } = await supabase
    .from("feedback")
    .select("target_type, target_id, thumbs_value")
    .eq("user_id", userId)
    .not("thumbs_value", "is", null)
    .in("target_type", types)
    .in("target_id", ids);

  const map = new Map<string, -1 | 1>();
  for (const row of data ?? []) {
    if (row.thumbs_value === 1 || row.thumbs_value === -1) {
      map.set(`${row.target_type}:${row.target_id}`, row.thumbs_value as -1 | 1);
    }
  }
  return map;
}
