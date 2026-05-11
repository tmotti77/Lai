import { RIASEC_ITEMS, RIASEC_ITEMS_VERSION } from "./items";
import type { RiasecResponses, RiasecScores, RiasecType } from "./types";
import { RIASEC_TYPES } from "./types";

export function scoreRiasec(
  responses: RiasecResponses,
  version: number,
): RiasecScores {
  if (version !== RIASEC_ITEMS_VERSION) {
    throw new Error(
      `Unsupported RIASEC items version: ${version} (current: ${RIASEC_ITEMS_VERSION})`,
    );
  }

  for (const item of RIASEC_ITEMS) {
    const r = responses[item.id];
    if (r === undefined) {
      throw new Error(`missing response for item ${item.id}`);
    }
    if (!Number.isInteger(r) || r < 1 || r > 5) {
      throw new Error(`response for ${item.id} out of range: ${r}`);
    }
  }

  const perType: Record<RiasecType, { sum: number; count: number }> = {
    R: { sum: 0, count: 0 },
    I: { sum: 0, count: 0 },
    A: { sum: 0, count: 0 },
    S: { sum: 0, count: 0 },
    E: { sum: 0, count: 0 },
    C: { sum: 0, count: 0 },
  };

  for (const item of RIASEC_ITEMS) {
    perType[item.type].sum += responses[item.id];
    perType[item.type].count += 1;
  }

  const normalize = (sum: number, count: number) =>
    Math.round(((sum - count) / (count * 4)) * 100); // 1..5 → 0..1

  const partial = {
    R: normalize(perType.R.sum, perType.R.count),
    I: normalize(perType.I.sum, perType.I.count),
    A: normalize(perType.A.sum, perType.A.count),
    S: normalize(perType.S.sum, perType.S.count),
    E: normalize(perType.E.sum, perType.E.count),
    C: normalize(perType.C.sum, perType.C.count),
  };

  const hollandCode = [...RIASEC_TYPES]
    .sort((a, b) => partial[b] - partial[a])
    .slice(0, 3)
    .join("");

  return { ...partial, hollandCode };
}
