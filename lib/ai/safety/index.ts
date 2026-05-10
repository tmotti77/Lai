import "server-only";
import { regexDistressCheck, type DistressResult } from "./regex";
import { classifyMessage, type Classification } from "./classifier";

export type SafetyDecision =
  | { allow: true; flag: null }
  | { allow: false; flag: "distress" | "crisis"; reason: string };

const FALSE_NEGATIVE_HEURISTIC_LENGTH = 80;

/**
 * Two-layer safety detector. Regex is the floor (legal protection). The LLM
 * classifier runs only when:
 *  - Regex hit at "distress" severity (the LLM may upgrade to "crisis"); OR
 *  - Regex is clean AND the message is unusually long (≥80 chars), giving more
 *    surface for the LLM to find missed signals.
 *
 * Short messages with no regex hit are presumed safe and skip the LLM call
 * to avoid spending $0.001 on every "yes"/"כן" reply.
 */
export async function checkUserMessage(message: string): Promise<SafetyDecision> {
  const regex = regexDistressCheck(message);

  // Crisis from regex → done. Always block.
  if (regex.hit && regex.severity === "crisis") {
    return { allow: false, flag: "crisis", reason: `regex: ${regex.matched}` };
  }

  // Distress from regex → LLM classifier may upgrade.
  if (regex.hit && regex.severity === "distress") {
    const cls = await classifyMessage(message).catch(() => null);
    if (cls?.category === "crisis") {
      return { allow: false, flag: "crisis", reason: `regex+llm: ${regex.matched}` };
    }
    return { allow: false, flag: "distress", reason: `regex: ${regex.matched}` };
  }

  // No regex hit on a long enough message → check with LLM.
  if (message.length >= FALSE_NEGATIVE_HEURISTIC_LENGTH) {
    const cls = await classifyMessage(message).catch(() => null);
    if (cls?.category === "crisis") {
      return { allow: false, flag: "crisis", reason: `llm: ${cls.reasoning}` };
    }
    if (cls?.category === "distress") {
      return { allow: false, flag: "distress", reason: `llm: ${cls.reasoning}` };
    }
  }

  return { allow: true, flag: null };
}

export type { DistressResult, Classification };
