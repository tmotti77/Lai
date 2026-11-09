import type { RiasecVector } from "./types";

/**
 * Deterministic chat-interest → RIASEC mapping (#50).
 *
 * Chat extraction stores interests as free-form labels ({label, label_he,
 * confidence}). Without a formal RIASEC assessment the interests dimension
 * (25% of the match) used to be null for most users. This derives a RIASEC
 * vector from those labels with a fixed keyword lexicon, so the result is
 * reproducible and testable. No LLM is involved at match time.
 *
 * Matching rules:
 * - English: whole words, case-insensitive. A trailing `*` means "word prefix"
 *   (`programm*` matches "programming"), so "art" never fires inside "start".
 * - Hebrew: a stem must start a word, optionally after up to two attached
 *   prefix letters (ו ה ב ל מ ש כ). This keeps "אמנות" out of "נאמנות" and
 *   "קוד" out of "פיקוד".
 * - An interest matching several letters splits its weight evenly between them.
 * - Weight per interest follows extraction confidence: high 1, medium 0.6, low 0.3.
 * - The summed vector is scaled so the strongest letter is 100. The interests
 *   scorer uses cosine similarity, so only the ratios between letters matter.
 */

export type ChatInterest = {
  label?: string;
  label_he?: string;
  confidence?: string;
};

type Letter = keyof RiasecVector;

const LETTERS: readonly Letter[] = ["R", "I", "A", "S", "E", "C"];

const CONFIDENCE_WEIGHT: Record<string, number> = {
  high: 1.0,
  medium: 0.6,
  low: 0.3,
};
const DEFAULT_WEIGHT = CONFIDENCE_WEIGHT.medium;

// Shared multi-letter keywords, listed once and spread into each letter below.
// Because weight splits evenly, each group lands 50/50 on its two letters:
// programming → I + C, tech/engineering → I + R, medicine/psychology → I + S,
// finance/investing → E + C.
//
// Most stems are plain text. A few carry a regex lookahead to exclude a
// specific unrelated word; each of those has a comment and a test.
const PROGRAMMING_EN = [
  "programm*", "coding", "code", "software", "cyber*", "app", "apps", "develop*",
  "information security",
];
const PROGRAMMING_HE = [
  "תכנות", "תכנת", "תוכנה", "קידוד", "פיתוח", "אפליקצי", "סייבר", "אבטחת מידע",
];
const TECH_EN = ["technolog*", "tech", "engineer*"];
const TECH_HE = ["טכנולוג", "הנדס"];
const HEALTH_MIND_EN = ["medic*", "psycholog*"];
const HEALTH_MIND_HE = ["רפואה", "רפואי", "פסיכולוג"];
const FINANCE_EN = ["financ*", "invest*"];
const FINANCE_HE = ["פיננס", "השקעות"];

const LEXICON: Record<Letter, { en: string[]; he: string[] }> = {
  R: {
    en: [
      ...TECH_EN,
      "build*", "construction", "mechanic*", "repair*", "fix*", "electric*", "electronic*",
      "hardware", "hands-on", "tool*", "carpentry", "woodwork*", "craft*", "outdoor*",
      "nature", "farm*", "agricultur*", "garden*", "animal*", "sport*", "fitness", "athlet*",
      "cook*", "culinary", "chef", "driving", "vehicle*", "cars", "aviation", "flying",
      "pilot*", "plumb*", "weld*", "machinery", "maintenance", "combat", "physical",
    ],
    he: [
      ...TECH_HE,
      "בנייה", "בניה", "בנאות", "מכונ", "מכני", "חשמל", "אלקטרוני", "תיקון", "תקן", "נגרות",
      // "שטח" (field work) but not "שטחי" (superficial).
      "טבע", "שטח(?!י)", "חקלא", "גינון", "בעלי חיים", "חיות", "ספורט", "כושר", "בישול", "מטבח",
      "קולינרי", "רכב", "נהיגה", "תעופה", "טיס", "חומרה", "קרבי", "ידיים", "מסגרות",
      "ריתוך", "אחזקה",
    ],
  },
  I: {
    en: [
      ...PROGRAMMING_EN, ...TECH_EN, ...HEALTH_MIND_EN,
      "scien*", "research*", "math*", "data", "analy*", "statistic*", "physics", "chemistry",
      "biolog*", "logic*", "puzzle*", "problem solving", "philosoph*", "computer*",
      "algorithm*", "ai", "artificial intelligence", "machine learning", "astronom*",
      "investigat*", "history", "econom*",
    ],
    he: [
      ...PROGRAMMING_HE, ...TECH_HE, ...HEALTH_MIND_HE,
      "מדע", "מחקר", "חקר", "מתמטיק", "נתונים", "דאטה", "ניתוח", "סטטיסטיק", "פיזיקה",
      "כימיה", "ביולוג", "היגיון", "לוגיק", "חידות", "פתרון בעיות", "פילוסופ", "מחשבים",
      "מדעי המחשב", "אלגוריתם", "בינה מלאכותית", "היסטוריה", "כלכלה", "אסטרונומ",
    ],
  },
  A: {
    en: [
      "art", "arts", "artist*", "design*", "music*", "writ*", "photograph*", "film*",
      "video*", "theat*", "acting", "actor", "danc*", "creativ*", "fashion", "draw*",
      "paint*", "content", "graphic*", "animation", "literature", "poet*", "architect*",
      "ux", "media", "singing", "sing", "edit*",
    ],
    he: [
      "אמנות", "אומנות", "עיצוב", "מוזיק", "נגינה", "שירה", "שירים", "כתיבה", "צילום",
      "סרט", "קולנוע", "וידאו", "תיאטרון", "ריקוד", "יצירתי", "יצירה", "אופנה", "ציור",
      "תוכן", "גרפי", "אנימציה", "ספרות", "אדריכל", "עריכה",
    ],
  },
  S: {
    en: [
      ...HEALTH_MIND_EN,
      "help*", "people", "teach*", "educat*", "counsel*", "therap*", "care", "caring",
      "caregiv*", "nurs*", "social work", "social", "community", "volunteer*", "kids",
      "children", "youth", "mentor*", "coach*", "guid*", "instruct*", "health*",
    ],
    he: [
      ...HEALTH_MIND_HE,
      "עזרה", "עזור", "אנשים", "הוראה", "ללמד", "חינוך", "הדרכה", "מדריך", "הדריך",
      "חונכ", "חניכה", "טיפול", "מטפל", "ייעוץ", "סיעוד", "עבודה סוציאלית", "קהילה",
      "התנדבות", "ילדים", "נוער", "אימון", "רווחה", "בריאות",
    ],
  },
  E: {
    en: [
      ...FINANCE_EN,
      "business*", "entrepreneur*", "startup*", "sales", "selling", "marketing", "manag*",
      "leader*", "leading", "politic*", "law", "legal", "lawyer*", "negotiat*",
      "real estate", "persua*", "public speaking", "command*", "officer*", "influenc*",
    ],
    he: [
      ...FINANCE_HE,
      "עסק", "יזמות", "יזם", "מכירות", "מכירה", "שיווק", "ניהול", "מנהל", "מנהיגות",
      "להוביל", "הובלה", "פוליטיק", "משפט", "עריכת דין", "עורך דין", "נדל", "משא ומתן",
      "סטארט", "פיקוד", "קצין", "שכנוע", "נאום",
    ],
  },
  C: {
    en: [
      ...PROGRAMMING_EN, ...FINANCE_EN,
      "organiz*", "organis*", "administrat*", "accounting", "accountan*", "bookkeep*",
      "logistic*", "planning", "operations", "office", "spreadsheet*", "excel",
      "procedur*", "quality control", "bank*", "insurance",
    ],
    he: [
      ...PROGRAMMING_HE, ...FINANCE_HE,
      // "סדר" (order) but not "סדרה"/"סדרות" (TV series).
      "לסדר", "מסודר", "סדר(?![הו])", "ארגון", "ארגן", "מנהלה", "אדמיניסטר",
      "הנהלת חשבונות", "חשבונאות", "רואה חשבון", "כספים", "לוגיסטיק", "תכנון", "תפעול",
      // "משרדי"/"משרדית" (office work), not bare "משרד" ("משרד הביטחון" is an employer).
      "אקסל", "בנק", "ביטוח", "בקרה", "נהלים", "משרדי",
    ],
  },
};

function englishPattern(entries: string[]): RegExp {
  const alts = entries.map((e) => (e.endsWith("*") ? `${e.slice(0, -1)}\\w*` : e));
  return new RegExp(`\\b(?:${alts.join("|")})\\b`, "i");
}

function hebrewPattern(stems: string[]): RegExp {
  // A plain stem ending in ה also matches its construct form ending in ת
  // ("כתיבה" → "כתיבת תוכן", "הדרכה" → "הדרכת חיילים").
  const alts = stems.map((s) => (/^[א-ת ]+ה$/.test(s) ? `${s.slice(0, -1)}[הת]` : s));
  // Not preceded by a Hebrew letter, then up to two attached prefix letters.
  return new RegExp(`(?<![\\u05D0-\\u05EA])[והבלמשכ]{0,2}(?:${alts.join("|")})`);
}

const PATTERNS: { letter: Letter; en: RegExp; he: RegExp }[] = LETTERS.map((letter) => ({
  letter,
  en: englishPattern(LEXICON[letter].en),
  he: hebrewPattern(LEXICON[letter].he),
}));

function lettersFor(interest: ChatInterest): Letter[] {
  const en = typeof interest.label === "string" ? interest.label : "";
  const he = typeof interest.label_he === "string" ? interest.label_he : "";
  if (!en && !he) return [];
  return PATTERNS.filter((p) => p.en.test(en) || p.he.test(he) || p.en.test(he)).map(
    (p) => p.letter,
  );
}

export function riasecFromChatInterests(
  interests: ChatInterest[] | null | undefined,
): RiasecVector | null {
  if (!Array.isArray(interests) || interests.length === 0) return null;

  const sums: RiasecVector = { R: 0, I: 0, A: 0, S: 0, E: 0, C: 0 };
  for (const interest of interests) {
    if (!interest || typeof interest !== "object") continue;
    const letters = lettersFor(interest);
    if (letters.length === 0) continue;
    const weight = CONFIDENCE_WEIGHT[interest.confidence ?? ""] ?? DEFAULT_WEIGHT;
    for (const letter of letters) sums[letter] += weight / letters.length;
  }

  const max = Math.max(...LETTERS.map((l) => sums[l]));
  if (max === 0) return null;

  const vector = { ...sums };
  for (const letter of LETTERS) vector[letter] = Math.round((sums[letter] / max) * 100);
  return vector;
}
