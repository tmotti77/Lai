/**
 * Curated Israeli cities for the constraints form's location field.
 *
 * Each city carries a `region` tag aligned to the broad regional terms used
 * in `content/occupations/*.json`'s `typical_locations` field. The matching
 * scorer treats either an exact city name match OR a region match as a
 * geographic fit.
 *
 * v1: ~40 major cities + the 5 broad regions ("the whole country" too).
 * Not exhaustive — the constraints form's input still accepts free-text fallback
 * for any city not in this list.
 */

export type CityRegion =
  | "תל אביב"
  | "ירושלים"
  | "חיפה"
  | "באר שבע"
  | "מרכז"
  | "שרון"
  | "צפון"
  | "דרום"
  | "כל הארץ";

export type City = { name_he: string; region: CityRegion };

export const CITIES: ReadonlyArray<City> = [
  // Tel Aviv metro
  { name_he: "תל אביב", region: "תל אביב" },
  { name_he: "תל אביב-יפו", region: "תל אביב" },

  // Greater Tel Aviv ("מרכז")
  { name_he: "רמת גן", region: "מרכז" },
  { name_he: "גבעתיים", region: "מרכז" },
  { name_he: "בני ברק", region: "מרכז" },
  { name_he: "בת ים", region: "מרכז" },
  { name_he: "חולון", region: "מרכז" },
  { name_he: "ראשון לציון", region: "מרכז" },
  { name_he: "רחובות", region: "מרכז" },
  { name_he: "פתח תקווה", region: "מרכז" },
  { name_he: "ראש העין", region: "מרכז" },
  { name_he: "מודיעין", region: "מרכז" },
  { name_he: "מודיעין-מכבים-רעות", region: "מרכז" },
  { name_he: "לוד", region: "מרכז" },
  { name_he: "רמלה", region: "מרכז" },
  { name_he: "אור יהודה", region: "מרכז" },
  { name_he: "יהוד", region: "מרכז" },

  // Sharon
  { name_he: "הרצליה", region: "שרון" },
  { name_he: "רעננה", region: "שרון" },
  { name_he: "כפר סבא", region: "שרון" },
  { name_he: "הוד השרון", region: "שרון" },
  { name_he: "נתניה", region: "שרון" },
  { name_he: "רמת השרון", region: "שרון" },

  // Jerusalem corridor
  { name_he: "ירושלים", region: "ירושלים" },
  { name_he: "מבשרת ציון", region: "ירושלים" },
  { name_he: "בית שמש", region: "ירושלים" },

  // Haifa metro
  { name_he: "חיפה", region: "חיפה" },
  { name_he: "קריית אתא", region: "חיפה" },
  { name_he: "קריית ים", region: "חיפה" },
  { name_he: "קריית ביאליק", region: "חיפה" },
  { name_he: "קריית מוצקין", region: "חיפה" },
  { name_he: "נשר", region: "חיפה" },
  { name_he: "טירת כרמל", region: "חיפה" },

  // North
  { name_he: "עכו", region: "צפון" },
  { name_he: "נהריה", region: "צפון" },
  { name_he: "צפת", region: "צפון" },
  { name_he: "טבריה", region: "צפון" },
  { name_he: "כרמיאל", region: "צפון" },
  { name_he: "עפולה", region: "צפון" },
  { name_he: "נצרת", region: "צפון" },
  { name_he: "נצרת עילית", region: "צפון" },

  // South
  { name_he: "באר שבע", region: "באר שבע" },
  { name_he: "אשדוד", region: "דרום" },
  { name_he: "אשקלון", region: "דרום" },
  { name_he: "קריית גת", region: "דרום" },
  { name_he: "דימונה", region: "דרום" },
  { name_he: "אילת", region: "דרום" },
  { name_he: "נתיבות", region: "דרום" },
  { name_he: "ערד", region: "דרום" },
  { name_he: "שדרות", region: "דרום" },
];

/**
 * Resolve a city name string to its region, or return null if the name is
 * not in the curated list (free-text fallback).
 */
export function regionForCity(name_he: string): CityRegion | null {
  const trimmed = name_he.trim();
  // Direct hit — including if user picked a region name itself.
  const REGIONS: ReadonlyArray<CityRegion> = [
    "תל אביב", "ירושלים", "חיפה", "באר שבע",
    "מרכז", "שרון", "צפון", "דרום", "כל הארץ",
  ];
  if (REGIONS.includes(trimmed as CityRegion)) return trimmed as CityRegion;
  const city = CITIES.find((c) => c.name_he === trimmed);
  return city?.region ?? null;
}
