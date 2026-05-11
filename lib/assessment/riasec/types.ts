export const RIASEC_TYPES = ["R", "I", "A", "S", "E", "C"] as const;
export type RiasecType = (typeof RIASEC_TYPES)[number];

export type RiasecItem = {
  id: string;            // stable id, e.g. "R1", "A3"
  type: RiasecType;
  text_he: string;
};

export type RiasecResponses = Record<string, number>; // itemId → 1..5

export type RiasecScores = {
  R: number; I: number; A: number; S: number; E: number; C: number;  // 0..100
  hollandCode: string;   // top-3 letters concatenated, e.g. "IAS"
};
