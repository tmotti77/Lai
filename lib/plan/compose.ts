import "server-only";
import { generateObject, type ModelMessage } from "ai";
import { z } from "zod";
import { anthropic, MODEL_ID } from "@/lib/ai/client";
import type { Archetype, TaskCategory } from "./types";
import { ARCHETYPE_INTENT_HE } from "./archetypes";
import type { Ranking, Occupation, MatchingProfile } from "@/lib/matching/types";
import { TASK_CATEGORIES } from "./types";

const TaskSchema = z.object({
  day: z.number().int().min(1).max(30),
  title_he: z.string().min(8).max(80),
  description_he: z.string().min(20).max(280),
  category: z.enum(TASK_CATEGORIES),
  estimated_minutes: z.number().int().min(10).max(240),
});

const ComposeSchema = z.object({
  tasks: z.array(TaskSchema).length(30),
});

export type ComposedTask = z.infer<typeof TaskSchema>;

const SYSTEM_PROMPT = `אתה כותב תוכנית פעולה של 30 יום בעברית עבור משתמש שקיבל המלצת קריירה. הוא בחר מסלול מסוים, ואתה מקבל את הפרופיל שלו ואת המקצוע הראשי.

החוקים שלך:
1. בדיוק 30 משימות, יום אחד לכל משימה.
2. כל משימה היא פעולה ספציפית שאפשר לסיים ביום אחד. לא "תחקור" — אלא "צפה ב-2 ראיונות בפודקאסט X" או "כתוב פסקה על מה שעניין אותך".
3. כל משימה מקבלת estimated_minutes (10-240).
4. category: action / research / network / reflection.
5. בנה התקדמות: השבוע הראשון בעיקר research/reflection, אמצע research/action, סוף בעיקר action/network.
6. השתמש בנתוני המשתמש (כישורים, ערכים, אילוצים) כדי להפוך את המשימות אישיות. עדיף לצטט מילים שלו אם אפשר.
7. אל תהיה גנרי. אל תכתוב "צור CV" — כתוב "עדכן את הסקשן 'ניסיון' ב-CV שלך עם תפקיד אחד מהשירות הצבאי בצורה שמתאימה ל[מקצוע]".
8. אל תכלול עברית רפואית/קלינית. אל תאבחן.`;

export async function composePlan(args: {
  archetype: Archetype;
  topOccupation: Occupation;
  topRanking: Ranking;
  topProse: string | null;
  profile: MatchingProfile;
}): Promise<ComposedTask[]> {
  const userContext = {
    archetype: args.archetype,
    archetype_intent: ARCHETYPE_INTENT_HE[args.archetype],
    top_occupation: {
      id: args.topOccupation.id,
      title_he: args.topOccupation.title_he,
      description_he: args.topOccupation.description_he,
    },
    why_this_role_he: args.topProse,
    profile: args.profile,
  };

  const messages: ModelMessage[] = [
    {
      role: "system",
      content: SYSTEM_PROMPT,
      providerOptions: { anthropic: { cacheControl: { type: "ephemeral" } } },
    },
    {
      role: "user",
      content: `בנה לי תוכנית 30 יום עם הנתונים הבאים:\n${JSON.stringify(userContext, null, 2)}`,
    },
  ];

  const result = await generateObject({
    model: anthropic(MODEL_ID),
    schema: ComposeSchema,
    messages,
  });

  return result.object.tasks;
}
