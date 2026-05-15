import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getOrCreateAnonymousUserId } from "@/lib/anonymous";
import {
  getInterviewSession,
  loadInterviewMessages,
  completeInterviewSession,
} from "@/lib/db/interview";
import { runWrapRepairCall } from "@/lib/interview/tools";
import { he } from "@/lib/i18n/he";

export const runtime = "nodejs";
export const maxDuration = 30;

const Body = z.object({ sessionId: z.uuid() });

export async function POST(req: Request) {
  let parsed: z.infer<typeof Body>;
  try {
    parsed = Body.parse(await req.json());
  } catch {
    return Response.json({ error: "bad_request" }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const userId = await getOrCreateAnonymousUserId(user?.id);

  const session = await getInterviewSession(parsed.sessionId);
  if (!session) return Response.json({ error: "session_not_found" }, { status: 404 });
  if (session.user_id !== userId) return Response.json({ error: "forbidden" }, { status: 403 });
  if (session.completed_at) return Response.json({ ok: true, alreadyCompleted: true });

  if (session.question_count < 3) {
    return Response.json({ error: "too_early", retry_after_questions: 3 }, { status: 409 });
  }

  // User-triggered wrap → run repair call to build feedback from transcript.
  const history = await loadInterviewMessages(session.id);
  const transcript = history.map((m) => ({ role: m.role, content: m.content }));
  const repaired = await runWrapRepairCall(transcript, session.target_role_he);
  if (repaired) {
    await completeInterviewSession(session.id, { ...repaired, forcedWrap: false });
    return Response.json({ ok: true });
  }
  await completeInterviewSession(session.id, {
    summary_he: he.interview.fallback.modelFailedToWrap,
    strengths_he: [he.interview.fallback.placeholderBullet],
    improvements_he: [he.interview.fallback.placeholderBullet],
    next_practice_focus_he: he.interview.fallback.defaultNextFocus,
    per_question: [],
    forcedWrap: true,
  });
  return Response.json({ ok: true, fallback: true });
}
