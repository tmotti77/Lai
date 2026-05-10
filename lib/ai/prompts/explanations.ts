import "server-only";
import { generateObject } from "ai";
import { z } from "zod";
import { anthropic, MODEL_ID } from "@/lib/ai/client";
import type { Ranking, Occupation, MatchingProfile } from "@/lib/matching/types";

const ProseSchema = z.object({
  explanations: z.array(
    z.object({
      occupation_id: z.string(),
      explanation_he: z.string().min(40).max(900),
    }),
  ),
});

export async function generateExplanations(args: {
  profile: MatchingProfile;
  rankings: Ranking[];
  occupations: Occupation[];
  topN?: number;
}): Promise<Record<string, string>> {
  const top = args.rankings.slice(0, args.topN ?? 5);
  const occMap = new Map(args.occupations.map((o) => [o.id, o]));

  const occContext = top.map((r) => {
    const occ = occMap.get(r.occupation_id);
    return {
      id: r.occupation_id,
      title_he: occ?.title_he,
      description_he: occ?.description_he,
      total_score: r.total_score,
      breakdown: r.breakdown,
    };
  });

  const profileContext = JSON.stringify(args.profile, null, 2);
  const occContextStr = JSON.stringify(occContext, null, 2);

  const result = await generateObject({
    model: anthropic(MODEL_ID),
    schema: ProseSchema,
    system: `אתה כותב הסברים קצרים בעברית למשתמש שקיבל המלצה על מקצוע. אתה מקבל את הפרופיל שלו (תחומי עניין, כישורים, ערכים, אילוצים) ואת הציונים של מקצוע מסוים, וכותב 3-5 משפטים שמסבירים *למה* המקצוע הזה התאים לו ספציפית. אל תכתוב כללי. אל תחזור על שם המקצוע יותר מפעם. אל תהפוך את הציונים למספרים בטקסט. הסבר את הקשר בין הפרופיל למקצוע — מה במקצוע מתאים למה שהמשתמש סיפר על עצמו, ומה החיסרון/אתגר.

מבנה: משפט פתיחה אישי → 1-2 משפטים על מה מתאים → משפט אחד על אתגר/דבר שצריך לקחת בחשבון → אופציונלי משפט פעולה הבא.`,
    prompt: `הפרופיל של המשתמש:\n${profileContext}\n\nהמקצועות (top ${top.length}):\n${occContextStr}\n\nהחזר הסבר אישי לכל מקצוע.`,
    providerOptions: {
      anthropic: {
        cacheControl: { type: "ephemeral" },
      },
    },
  });

  const out: Record<string, string> = {};
  for (const e of result.object.explanations) {
    out[e.occupation_id] = e.explanation_he;
  }
  return out;
}
