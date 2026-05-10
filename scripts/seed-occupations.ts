import { config as loadEnv } from "dotenv";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/db/types.gen";

// Load .env.local first (Next.js convention), then .env as fallback
loadEnv({ path: ".env.local" });
loadEnv();

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const supabase = createClient<Database>(url, serviceKey);

const SKILLS_FILE = "content/skills/taxonomy.json";
const OCC_DIR = "content/occupations";

type SkillRow = {
  id: string;
  name_he: string;
  category: string;
  related_ids: string[];
};

type Taxonomy = {
  version: number;
  skills: SkillRow[];
};

async function seedSkills() {
  const taxonomy = JSON.parse(readFileSync(SKILLS_FILE, "utf8")) as Taxonomy;
  const rows = taxonomy.skills.map((s) => ({
    id: s.id,
    name_he: s.name_he,
    category: s.category,
    related_ids: s.related_ids,
  }));
  const { error } = await supabase.from("skills").upsert(rows);
  if (error) throw error;
  console.log(`OK seeded ${rows.length} skills`);
}

async function seedOccupations() {
  const files = readdirSync(OCC_DIR).filter((f) => f.endsWith(".json") && !f.startsWith("_"));
  const rows = files.map((file) => {
    const occ = JSON.parse(readFileSync(join(OCC_DIR, file), "utf8"));
    return {
      id: occ.id,
      title_he: occ.title_he,
      title_en: occ.title_en,
      description_he: occ.description_he,
      riasec_affinity: occ.riasec_affinity,
      required_skills: occ.required_skills,
      desired_skills: occ.desired_skills,
      values_fit: occ.values_fit,
      big5_fit: occ.big5_fit ?? null,
      constraints: occ.constraints,
      market: occ.market,
      data_source: occ.data_source,
      last_verified_at: occ.last_verified_at,
    };
  });
  const { error } = await supabase.from("occupations").upsert(rows);
  if (error) throw error;
  console.log(`OK seeded ${rows.length} occupations`);
}

async function bumpCatalogVersion() {
  const { data, error: readErr } = await supabase
    .from("catalog_version")
    .select("version")
    .eq("id", 1)
    .single();
  if (readErr) throw readErr;
  const next = (data?.version ?? 0) + 1;
  const { error } = await supabase
    .from("catalog_version")
    .update({ version: next, updated_at: new Date().toISOString() })
    .eq("id", 1);
  if (error) throw error;
  console.log(`OK catalog_version -> ${next}`);
}

async function main() {
  await seedSkills();
  await seedOccupations();
  await bumpCatalogVersion();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
