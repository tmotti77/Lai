-- Add three hands-on occupations that were in content/ but not seeded to production DB
-- These are needed for matching tests and production matching of Realistic-dominant profiles.

-- HVAC Technician
INSERT INTO public.occupations (
  id, 
  title_he, 
  title_en, 
  description_he, 
  riasec_affinity, 
  required_skills, 
  desired_skills, 
  values_fit, 
  big5_fit, 
  constraints, 
  market, 
  data_source, 
  last_verified_at
) VALUES (
  'hvac-technician',
  'טכנאי/ת מיזוג אוויר',
  'HVAC Technician',
  'התקנה, תחזוקה ותיקון של מערכות מיזוג אוויר ומערכות קירור במבנים מגורים ומסחריים. מקצוע מבוקש בישראל בגלל האקלים, עם ביקוש גבוה בעונות החמות. שילוב של עבודת ידיים עם ידע טכני בחשמל וגזים. אפשרות לעבודה עצמאית או כשכיר/ה.',
  '{"R": 0.95, "I": 0.45, "A": 0.10, "S": 0.25, "E": 0.35, "C": 0.60}'::jsonb,
  '[
    {"skill_id": "hvac-systems", "importance": 1.0},
    {"skill_id": "tool-use", "importance": 0.9},
    {"skill_id": "electrical-systems", "importance": 0.75},
    {"skill_id": "problem-solving", "importance": 0.8},
    {"skill_id": "manual-dexterity", "importance": 0.85}
  ]'::jsonb,
  '[
    {"skill_id": "customer-service", "importance": 0.5},
    {"skill_id": "safety", "importance": 0.75},
    {"skill_id": "physical-stamina", "importance": 0.6}
  ]'::jsonb,
  ARRAY['money', 'stability', 'freedom'],
  '{"C": 65}'::jsonb,
  '{
    "typical_training_months": 9,
    "typical_training_cost_nis": 12000,
    "requires_english_level": "none",
    "remote_ok": false,
    "typical_locations": ["כל הארץ"]
  }'::jsonb,
  '{
    "demand_he": "high",
    "typical_salary_nis_min": 11000,
    "typical_salary_nis_max": 26000,
    "ai_risk": "low"
  }'::jsonb,
  'public_knowledge_v1_2026-05',
  '2026-09-03T00:00:00Z'
)
ON CONFLICT (id) DO UPDATE SET
  title_he = EXCLUDED.title_he,
  title_en = EXCLUDED.title_en,
  description_he = EXCLUDED.description_he,
  riasec_affinity = EXCLUDED.riasec_affinity,
  required_skills = EXCLUDED.required_skills,
  desired_skills = EXCLUDED.desired_skills,
  values_fit = EXCLUDED.values_fit,
  big5_fit = EXCLUDED.big5_fit,
  constraints = EXCLUDED.constraints,
  market = EXCLUDED.market,
  data_source = EXCLUDED.data_source,
  last_verified_at = EXCLUDED.last_verified_at,
  updated_at = now();

-- Security Systems Installer
INSERT INTO public.occupations (
  id, 
  title_he, 
  title_en, 
  description_he, 
  riasec_affinity, 
  required_skills, 
  desired_skills, 
  values_fit, 
  big5_fit, 
  constraints, 
  market, 
  data_source, 
  last_verified_at
) VALUES (
  'security-systems-installer',
  'טכנאי/ת מערכות אבטחה',
  'Security Systems Installer',
  'התקנה ותחזוקה של מערכות אבטחה: מצלמות, מערכות אזעקה, בקרת כניסה ומערכות ביומטריות. מקצוע מבוקש בישראל בגלל המצב הביטחוני והצורך הגבוה במערכות הגנה. שילוב של עבודה פיזית עם ידע טכני בחשמל, רשתות ותקשורת. נדרשת בדיקת ביטחון.',
  '{"R": 0.90, "I": 0.55, "A": 0.10, "S": 0.30, "E": 0.35, "C": 0.70}'::jsonb,
  '[
    {"skill_id": "electrical-systems", "importance": 0.95},
    {"skill_id": "networking", "importance": 0.75},
    {"skill_id": "tool-use", "importance": 0.9},
    {"skill_id": "problem-solving", "importance": 0.85},
    {"skill_id": "attention-to-detail", "importance": 0.8}
  ]'::jsonb,
  '[
    {"skill_id": "customer-service", "importance": 0.5},
    {"skill_id": "manual-dexterity", "importance": 0.7},
    {"skill_id": "english-technical", "importance": 0.45}
  ]'::jsonb,
  ARRAY['money', 'stability', 'challenge'],
  '{"C": 70}'::jsonb,
  '{
    "typical_training_months": 6,
    "typical_training_cost_nis": 8000,
    "requires_english_level": "basic",
    "remote_ok": false,
    "typical_locations": ["כל הארץ"]
  }'::jsonb,
  '{
    "demand_he": "high",
    "typical_salary_nis_min": 10000,
    "typical_salary_nis_max": 24000,
    "ai_risk": "low"
  }'::jsonb,
  'public_knowledge_v1_2026-05',
  '2026-09-03T00:00:00Z'
)
ON CONFLICT (id) DO UPDATE SET
  title_he = EXCLUDED.title_he,
  title_en = EXCLUDED.title_en,
  description_he = EXCLUDED.description_he,
  riasec_affinity = EXCLUDED.riasec_affinity,
  required_skills = EXCLUDED.required_skills,
  desired_skills = EXCLUDED.desired_skills,
  values_fit = EXCLUDED.values_fit,
  big5_fit = EXCLUDED.big5_fit,
  constraints = EXCLUDED.constraints,
  market = EXCLUDED.market,
  data_source = EXCLUDED.data_source,
  last_verified_at = EXCLUDED.last_verified_at,
  updated_at = now();

-- Dental Technician
INSERT INTO public.occupations (
  id, 
  title_he, 
  title_en, 
  description_he, 
  riasec_affinity, 
  required_skills, 
  desired_skills, 
  values_fit, 
  big5_fit, 
  constraints, 
  market, 
  data_source, 
  last_verified_at
) VALUES (
  'dental-technician',
  'טכנאי/ת שיניים',
  'Dental Technician',
  'עיצוב וייצור של שיניים תותבות, כתרים, גשרים ומכשירים אורתודונטיים במעבדת שיניים. עבודה מדויקת עם הידיים בשילוב טכנולוגיה חדשה (הדפסות תלת-מימד, סריקות דיגיטליות). תפקיד למי שאוהב/ת עבודה עם פרטים קטנים ואומנות טכנית, בלי מגע ישיר עם מטופלים.',
  '{"R": 0.80, "I": 0.50, "A": 0.60, "S": 0.20, "E": 0.20, "C": 0.75}'::jsonb,
  '[
    {"skill_id": "manual-dexterity", "importance": 1.0},
    {"skill_id": "attention-to-detail", "importance": 0.95},
    {"skill_id": "anatomy", "importance": 0.6},
    {"skill_id": "tool-use", "importance": 0.8}
  ]'::jsonb,
  '[
    {"skill_id": "3d-modeling", "importance": 0.5},
    {"skill_id": "patience", "importance": 0.7},
    {"skill_id": "artistic-ability", "importance": 0.6}
  ]'::jsonb,
  ARRAY['money', 'stability', 'craftsmanship'],
  '{"C": 80, "O": 55}'::jsonb,
  '{
    "typical_training_months": 24,
    "typical_training_cost_nis": 25000,
    "requires_english_level": "basic",
    "remote_ok": false,
    "typical_locations": ["מרכז", "תל אביב", "שרון", "ירושלים", "חיפה", "באר שבע"]
  }'::jsonb,
  '{
    "demand_he": "medium",
    "typical_salary_nis_min": 11000,
    "typical_salary_nis_max": 22000,
    "ai_risk": "medium"
  }'::jsonb,
  'public_knowledge_v1_2026-05',
  '2026-09-03T00:00:00Z'
)
ON CONFLICT (id) DO UPDATE SET
  title_he = EXCLUDED.title_he,
  title_en = EXCLUDED.title_en,
  description_he = EXCLUDED.description_he,
  riasec_affinity = EXCLUDED.riasec_affinity,
  required_skills = EXCLUDED.required_skills,
  desired_skills = EXCLUDED.desired_skills,
  values_fit = EXCLUDED.values_fit,
  big5_fit = EXCLUDED.big5_fit,
  constraints = EXCLUDED.constraints,
  market = EXCLUDED.market,
  data_source = EXCLUDED.data_source,
  last_verified_at = EXCLUDED.last_verified_at,
  updated_at = now();

-- Bump catalog version to invalidate cached recommendations
UPDATE public.catalog_version 
SET version = version + 1, updated_at = now() 
WHERE id = 1;
