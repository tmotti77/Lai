import "server-only";
import { createServiceClient } from "@/lib/supabase/service";
import type { Occupation } from "@/lib/matching/types";

export async function loadAllOccupations(): Promise<Occupation[]> {
  const svc = createServiceClient();
  const { data, error } = await svc.from("occupations").select("*");
  if (error) throw error;

  return (data ?? []).map((row) => ({
    id: row.id,
    title_he: row.title_he,
    title_en: row.title_en,
    description_he: row.description_he,
    riasec_affinity: row.riasec_affinity as Occupation["riasec_affinity"],
    required_skills: row.required_skills as Occupation["required_skills"],
    desired_skills: row.desired_skills as Occupation["desired_skills"],
    values_fit: row.values_fit ?? [],
    big5_fit: (row.big5_fit as Occupation["big5_fit"]) ?? undefined,
    constraints: row.constraints as Occupation["constraints"],
    market: row.market as Occupation["market"],
    data_source: row.data_source,
    last_verified_at: row.last_verified_at,
  }));
}

export async function loadCatalogVersion(): Promise<number> {
  const svc = createServiceClient();
  const { data, error } = await svc.from("catalog_version").select("version").eq("id", 1).single();
  if (error) throw error;
  return data.version;
}
