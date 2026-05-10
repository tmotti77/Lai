export const BIG5_TRAITS = ["O", "C", "E", "A", "N"] as const;
export type Big5Trait = (typeof BIG5_TRAITS)[number];

export type Big5Item = {
  id: string;            // e.g. "O1", "N3"
  trait: Big5Trait;
  text_he: string;
  reverseKeyed: boolean; // if true, score is 6 - response
};

export type Big5Responses = Record<string, number>; // itemId → 1..5

export type Big5Scores = {
  O: number; C: number; E: number; A: number; N: number; // 0..100
};
