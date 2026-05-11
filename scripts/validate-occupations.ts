import Ajv from "ajv";
import addFormats from "ajv-formats";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

interface SkillRef {
  skill_id: string;
  importance: number;
}

interface Occupation {
  id: string;
  required_skills: SkillRef[];
  desired_skills: SkillRef[];
  [key: string]: unknown;
}

interface Taxonomy {
  version: number;
  skills: { id: string; name_he: string; category: string; related_ids: string[] }[];
}

const SCHEMA_PATH = "content/occupations/_schema.json";
const OCC_DIR = "content/occupations";
const SKILLS_PATH = "content/skills/taxonomy.json";

const ajv = new Ajv({ allErrors: true });
addFormats(ajv);

const schema = JSON.parse(readFileSync(SCHEMA_PATH, "utf8"));
const validate = ajv.compile(schema);

const taxonomy = JSON.parse(readFileSync(SKILLS_PATH, "utf8")) as Taxonomy;
const validSkillIds = new Set<string>(taxonomy.skills.map((s) => s.id));

let errorCount = 0;

const files = readdirSync(OCC_DIR).filter((f) => f.endsWith(".json") && !f.startsWith("_"));
for (const file of files) {
  const path = join(OCC_DIR, file);
  const occ = JSON.parse(readFileSync(path, "utf8")) as Occupation;

  if (!validate(occ)) {
    errorCount += 1;
    console.error(`X ${file}:`);
    for (const err of validate.errors ?? []) {
      console.error(`   ${err.instancePath} ${err.message}`);
    }
    continue;
  }

  const allRefs = [
    ...occ.required_skills.map((s) => s.skill_id),
    ...occ.desired_skills.map((s) => s.skill_id),
  ];
  const unknown = allRefs.filter((id) => !validSkillIds.has(id));
  if (unknown.length > 0) {
    errorCount += 1;
    console.error(`X ${file}: unknown skill ids: ${unknown.join(", ")}`);
    continue;
  }

  if (occ.id !== file.replace(/\.json$/, "")) {
    errorCount += 1;
    console.error(`X ${file}: id "${occ.id}" doesn't match filename`);
    continue;
  }
}

if (errorCount === 0) {
  console.log(`OK ${files.length} occupations valid`);
  process.exit(0);
}
console.error(`\n${errorCount} validation error(s)`);
process.exit(1);
