import "server-only";
import { getPersona } from "./personas";
import type { PersonaId } from "./types";

const BASE_RULES = `אתה מראיין מנוסה בישראל. תפקידך לקיים ראיון עבודה מציאותי בעברית עבור משתמש המתאמן לקראת ראיון אמיתי לתפקיד {target_role_he}.

כללים קריטיים:
1. שאל שאלה אחת בכל הודעה — לעולם לא יותר מאחת.
2. תישאר באופי. אתה מראיין, לא מאמן. אל תיתן משוב, אל תסביר למה שאלת, אל תעזור לנסח. רק שאל ותקשיב.
3. הקשב באמת — שאלת המשך טבעית בהתאם לתשובה אם זה מתאים, או מעבר לנושא הבא.
4. אחרי שמכסת השאלות הסתיימה (תקבל את המספר בכל הודעה), חובה לקרוא לכלי wrap_up עם משוב מובנה.
5. אל תקרא לכלי wrap_up לפני ששאלת לפחות חמש שאלות. אל תחכה מעבר למכסה.
6. אל תאשר את התשובה ("מצוין!", "תשובה נהדרת"). מראיין אמיתי לא מתפעל. אישור קצר ("הבנתי", "תודה") ומעבר לשאלה הבאה.
7. עברית ניטרלית מגדרית בלבד: "את/ה", "ספר/י", "התמודד/ת", "תאר/י". לעולם אל תניח מגדר של המרואיין/ת.

פרטי הראיון:
- תפקיד יעד: {target_role_he}
`;

export interface ComposeSystemPromptArgs {
  persona: PersonaId;
  targetRoleHe: string;
  occupationSkills: string[] | null;
}

export function composeSystemPrompt({
  persona,
  targetRoleHe,
  occupationSkills,
}: ComposeSystemPromptArgs): string {
  const personaDef = getPersona(persona);
  const base = BASE_RULES.replace(/\{target_role_he\}/g, targetRoleHe);

  let overlay = personaDef.system_prompt_overlay.replace(/\{target_role_he\}/g, targetRoleHe);

  if (persona === "technical" && occupationSkills && occupationSkills.length > 0) {
    const skillsBlock = `\n\nכישורי-יעד לשאילה (בחר/י 2-3 מהרשימה כזרע לנושאי שאלה — לא רשימת בדיקה):\n${occupationSkills.map((s) => `- ${s}`).join("\n")}\n`;
    overlay = overlay.replace("חובה: כשתגיע", `${skillsBlock}\nחובה: כשתגיע`);
  }

  return `${base}\n${overlay}\n`;
}

export interface ComposeTurnPreambleArgs {
  questionCount: number;
  maxQuestions: number;
}

export function composeTurnPreamble({ questionCount, maxQuestions }: ComposeTurnPreambleArgs): string {
  if (questionCount >= maxQuestions) {
    return `[המשתמש סיים לענות על השאלה האחרונה. הראיון הסתיים. עליך לקרוא לכלי wrap_up עכשיו עם המשוב המובנה. אל תשאל שאלה נוספת.]`;
  }
  return `[שאלה ${questionCount + 1} מתוך ${maxQuestions}]`;
}
