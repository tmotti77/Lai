import { BIG5_ITEMS, BIG5_ITEMS_VERSION } from "./items";
import type { Big5Responses, Big5Scores, Big5Trait } from "./types";

export function scoreBig5(responses: Big5Responses, version: number): Big5Scores {
  if (version !== BIG5_ITEMS_VERSION) {
    throw new Error(
      `Unsupported Big5 items version: ${version} (current: ${BIG5_ITEMS_VERSION})`,
    );
  }

  for (const item of BIG5_ITEMS) {
    const r = responses[item.id];
    if (r === undefined) throw new Error(`missing response for item ${item.id}`);
    if (!Number.isInteger(r) || r < 1 || r > 5) {
      throw new Error(`response for ${item.id} out of range: ${r}`);
    }
  }

  const perTrait: Record<Big5Trait, { sum: number; count: number }> = {
    O: { sum: 0, count: 0 },
    C: { sum: 0, count: 0 },
    E: { sum: 0, count: 0 },
    A: { sum: 0, count: 0 },
    N: { sum: 0, count: 0 },
  };

  for (const item of BIG5_ITEMS) {
    const raw = responses[item.id];
    const effective = item.reverseKeyed ? 6 - raw : raw;
    perTrait[item.trait].sum += effective;
    perTrait[item.trait].count += 1;
  }

  const normalize = (sum: number, count: number) =>
    Math.round(((sum - count) / (count * 4)) * 100);

  return {
    O: normalize(perTrait.O.sum, perTrait.O.count),
    C: normalize(perTrait.C.sum, perTrait.C.count),
    E: normalize(perTrait.E.sum, perTrait.E.count),
    A: normalize(perTrait.A.sum, perTrait.A.count),
    N: normalize(perTrait.N.sum, perTrait.N.count),
  };
}
