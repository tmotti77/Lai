import type { Big5Item } from "./types";

export const BIG5_ITEMS_VERSION = 1;

// 4 items per trait (2 keyed + 2 reverse-keyed) — IPIP-NEO short form, Hebrew.
export const BIG5_ITEMS: Big5Item[] = [
  // Openness
  { id: "O1", trait: "O", reverseKeyed: false, text_he: "יש לי דמיון פעיל." },
  { id: "O2", trait: "O", reverseKeyed: false, text_he: "אני אוהב לחשוב על רעיונות מופשטים." },
  { id: "O3", trait: "O", reverseKeyed: true,  text_he: "אין לי עניין מיוחד באמנות." },
  { id: "O4", trait: "O", reverseKeyed: true,  text_he: "אני מעדיף שגרה על פני שינויים תכופים." },

  // Conscientiousness
  { id: "C1", trait: "C", reverseKeyed: false, text_he: "אני שם לב לפרטים קטנים." },
  { id: "C2", trait: "C", reverseKeyed: false, text_he: "אני מסיים מה שהתחלתי." },
  { id: "C3", trait: "C", reverseKeyed: true,  text_he: "לפעמים אני שוכח להחזיר דברים למקום." },
  { id: "C4", trait: "C", reverseKeyed: true,  text_he: "קשה לי להתחיל משימה ללא דחיפה מבחוץ." },

  // Extraversion
  { id: "E1", trait: "E", reverseKeyed: false, text_he: "אני נהנה להיות במרכז קבוצה." },
  { id: "E2", trait: "E", reverseKeyed: false, text_he: "אני פותח שיחה בקלות עם אנשים שלא הכרתי." },
  { id: "E3", trait: "E", reverseKeyed: true,  text_he: "אני מעדיף לבלות זמן לבד מאשר עם אנשים." },
  { id: "E4", trait: "E", reverseKeyed: true,  text_he: "במסיבות אני נוטה להישאר בצד." },

  // Agreeableness
  { id: "A1", trait: "A", reverseKeyed: false, text_he: "אני מתעניין במה שאחרים מרגישים." },
  { id: "A2", trait: "A", reverseKeyed: false, text_he: "אני נוטה לתת לאנשים את ההזדמנות השנייה." },
  { id: "A3", trait: "A", reverseKeyed: true,  text_he: "אני מתעצבן בקלות על אנשים." },
  { id: "A4", trait: "A", reverseKeyed: true,  text_he: "אני יכול להיות ישיר עד כדי קשיחות." },

  // Neuroticism
  { id: "N1", trait: "N", reverseKeyed: false, text_he: "אני נוטה לדאוג גם על דברים קטנים." },
  { id: "N2", trait: "N", reverseKeyed: false, text_he: "אני יכול להישאב לתחושות שליליות לאורך זמן." },
  { id: "N3", trait: "N", reverseKeyed: true,  text_he: "ברוב המקרים אני נשאר רגוע גם בלחץ." },
  { id: "N4", trait: "N", reverseKeyed: true,  text_he: "אני חוזר לעצמי מהר אחרי דברים שמכעיסים אותי." },
];
