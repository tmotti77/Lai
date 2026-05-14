/* eslint-disable no-console */
import "dotenv/config";
import {
  createInterviewSession,
  getInterviewSession,
} from "@/lib/db/interview";

const TARGET_USER_ID = process.env.E2E_USER_ID;
if (!TARGET_USER_ID) {
  console.error(
    "Set E2E_USER_ID to a real users.id row in your local Supabase before running.",
  );
  process.exit(1);
}

const SAMPLE_ANSWERS = [
  "עבדתי בצוות של 4 מתכנתים על מערכת ניטור. ניהלתי קונפליקט סביב בחירת בסיס נתונים על ידי כתיבת מסמך טרייד-אוף.",
  "אני לומד הכי טוב על ידי בנייה — קורא תיעוד תוך כדי כתיבת קוד, לא לפני.",
  "המוטיבציה שלי היא לבנות דברים שאנשים אמיתיים משתמשים בהם.",
  "סדרי עדיפויות אצלי הם לפי השפעה על המשתמש, לא לפי קושי טכני.",
  "טעות שעשיתי: דחפתי מיגרציה שגרמה לרגרסיה — למדתי לעשות בדיקות סטייג'ינג יותר עמוקות.",
  "אני מנהל זמן על ידי חלוקה ל-blocks של שעתיים, ללא פגישות בבוקר.",
  "הסגנון שלי הוא לכתוב קוד פשוט שיהיה קל לתחזק, גם אם זה אומר יותר שורות.",
  "האתגר הכי גדול שלי היה לבד על פרויקט שדרש 3 מומחים — ניהלתי על ידי learning loops קצרים.",
];

async function main() {
  const session = await createInterviewSession({
    userId: TARGET_USER_ID as string,
    persona: "hr",
    targetOccupationId: null,
    targetRoleHe: "מהנדס/ת תוכנה",
    maxQuestions: 8,
  });
  console.log(`[e2e] session ${session.id} created`);

  const base = process.env.E2E_BASE_URL ?? "http://localhost:3000";

  // Kick off with the sentinel.
  await fetch(`${base}/api/interview`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action: "turn",
      sessionId: session.id,
      message: "__start__",
    }),
  });

  for (const answer of SAMPLE_ANSWERS) {
    const res = await fetch(`${base}/api/interview`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "turn",
        sessionId: session.id,
        message: answer,
      }),
    });
    // Drain the stream so onFinish fires server-side.
    if (res.body) {
      const reader = res.body.getReader();
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const { done } = await reader.read();
        if (done) break;
      }
    }
    const fresh = await getInterviewSession(session.id);
    console.log(
      `[e2e] turn done: q_count=${fresh?.question_count} completed=${!!fresh?.completed_at} forced=${fresh?.forced_wrap}`,
    );
    if (fresh?.completed_at) break;
  }

  const final = await getInterviewSession(session.id);
  console.log("=== final state ===");
  console.log(JSON.stringify(final, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
