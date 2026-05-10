export type DistressResult =
  | { hit: false }
  | { hit: true; severity: "distress" | "crisis"; matched: string };

// Highest severity: explicit suicide / self-harm ideation. These ALWAYS short-circuit.
const CRISIS_PATTERNS_HE: RegExp[] = [
  /אני רוצה למות/,
  /אני לא רוצה לחיות/,
  /חושב על התאבדות/,
  /רוצה להתאבד/,
  /לא שווה לחיות/,
  /אסיים את חיי/,
  /אפגע בעצמי/,
  /רוצה לפגוע בעצמי/,
];

const CRISIS_PATTERNS_EN: RegExp[] = [
  /\b(want|going) to (kill|hurt) myself\b/i,
  /\b(commit|attempt) suicide\b/i,
  /\bend(ing)? it all\b/i,
  /\bdon'?t want to (live|be alive)\b/i,
  /\bself[- ]?harm\b/i,
];

// Lower severity: severe emotional distress without explicit ideation.
// Still triggers handoff (we are not a therapist), but classified as "distress".
const DISTRESS_PATTERNS_HE: RegExp[] = [
  /בייאוש מוחלט/,
  /אין לי מי לדבר איתו/,
  /אני שבור לחלוטין/,
  /כבר לא יכול יותר/,
  /אני קורס נפשית/,
];

const DISTRESS_PATTERNS_EN: RegExp[] = [
  /\b(complete|total) despair\b/i,
  /\bcan'?t (take|do) (it|this) any ?more\b/i,
  /\bno one to talk to\b/i,
  /\bbreaking down\b/i,
];

export function regexDistressCheck(input: string): DistressResult {
  if (!input || input.length < 3) return { hit: false };

  for (const re of CRISIS_PATTERNS_HE) {
    const m = input.match(re);
    if (m) return { hit: true, severity: "crisis", matched: m[0] };
  }
  for (const re of CRISIS_PATTERNS_EN) {
    const m = input.match(re);
    if (m) return { hit: true, severity: "crisis", matched: m[0] };
  }
  for (const re of DISTRESS_PATTERNS_HE) {
    const m = input.match(re);
    if (m) return { hit: true, severity: "distress", matched: m[0] };
  }
  for (const re of DISTRESS_PATTERNS_EN) {
    const m = input.match(re);
    if (m) return { hit: true, severity: "distress", matched: m[0] };
  }

  return { hit: false };
}
