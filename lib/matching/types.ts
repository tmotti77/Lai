export type DimensionName = "interests" | "skills" | "values" | "big5" | "constraints" | "market";

export type RiasecVector = { R: number; I: number; A: number; S: number; E: number; C: number };
export type Big5Vector = { O: number; C: number; E: number; A: number; N: number };

export type MatchingProfile = {
  // Each dimension is null when the user has no signal for it.
  interests: RiasecVector | null;          // 0..100 each
  skills: { id: string; level: number }[] | null;   // level 0..1; ids are taxonomy ids OR free-form labels
  values: { topThree: string[]; alsoPicked: string[] } | null;
  big5: Big5Vector | null;                 // 0..100 each
  constraints: {
    location_he?: string;
    remote_ok?: boolean;
    time_per_week_hours?: number;
    training_budget_nis?: number;
    english_level?: "none" | "basic" | "intermediate" | "advanced" | "fluent";
    risk_tolerance?: number;
    needs_immediate_income?: boolean;
    months_until_income_required?: number;
  } | null;
};

export type Occupation = {
  id: string;
  title_he: string;
  title_en: string;
  description_he: string;
  riasec_affinity: { R: number; I: number; A: number; S: number; E: number; C: number };  // 0..1
  required_skills: { skill_id: string; importance: number }[];
  desired_skills: { skill_id: string; importance: number }[];
  values_fit: string[];
  big5_fit?: Partial<Big5Vector>;          // 0..100 per trait, only present traits matter
  constraints: {
    typical_training_months: number;
    typical_training_cost_nis: number;
    requires_english_level: "none" | "basic" | "intermediate" | "advanced" | "fluent";
    remote_ok: boolean;
    typical_locations: string[];
  };
  market: {
    demand_he: "low" | "medium" | "high" | "very_high";
    typical_salary_nis_min: number;
    typical_salary_nis_max: number;
    ai_risk: "low" | "medium" | "high";
  };
  data_source: string;
  last_verified_at: string;
};

export type ScoreBreakdown = {
  interests: number | null;
  skills: number | null;
  values: number | null;
  big5: number | null;
  constraints: number | null;
  market: number | null;
};

export type Ranking = {
  occupation_id: string;
  total_score: number;                    // 0..100
  breakdown: ScoreBreakdown;
  weights_used: Partial<Record<DimensionName, number>>;  // re-normalized
};

export type Paths = {
  safe: string | null;
  growth: string | null;
  wildcard: string | null;
};

export type RecommendationResult = {
  rankings: Ranking[];                    // top-N, sorted desc by total_score
  paths: Paths;
};
