import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getOrCreateAnonymousUserId } from "@/lib/anonymous";
import { requireConsent, NoConsentError } from "@/lib/consent";
import { createServiceClient } from "@/lib/supabase/service";
import { track } from "@/lib/analytics";
import { loadAllOccupations } from "@/lib/db/occupations";
import * as Sentry from "@sentry/nextjs";

const ThumbBody = z.object({
  kind: z.literal("thumb"),
  surface: z.enum(["chat", "recommendations", "interview"]),
  target_type: z.enum(["message", "recommendation_occupation", "interview_session"]),
  target_id: z.string().min(1).max(128),
  thumbs_value: z.union([z.literal(1), z.literal(-1), z.null()]),
  metadata: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
}).strict();

const NpsBody = z.object({
  kind: z.literal("nps"),
  nps_score: z.number().int().min(0).max(10),
  nps_trigger: z.enum(["pdf_download", "plan_generated", "interview_completed"]),
  comment_he: z.string().max(1000).nullable().optional(),
});

export const FeedbackBody = z.discriminatedUnion("kind", [ThumbBody, NpsBody]);
export type FeedbackBodyT = z.infer<typeof FeedbackBody>;

export async function POST(req: NextRequest) {
  let body: FeedbackBodyT;
  try {
    body = FeedbackBody.parse(await req.json());
  } catch {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  let userId: string;
  try {
    userId = await getOrCreateAnonymousUserId();
    await requireConsent(userId);
  } catch (err) {
    if (err instanceof NoConsentError) {
      return NextResponse.json({ error: "consent_required" }, { status: 403 });
    }
    throw err;
  }

  const supabase = createServiceClient();

  try {
    if (body.kind === "thumb") {
      // 1. Target ownership validation
      if (body.target_type === "message") {
        const { data } = await supabase
          .from("messages")
          .select("id, conversations!inner(user_id)")
          .eq("id", body.target_id)
          .eq("conversations.user_id", userId)
          .maybeSingle();
        if (!data) return NextResponse.json({ error: "target_not_found" }, { status: 404 });
      } else if (body.target_type === "interview_session") {
        const { data } = await supabase
          .from("interview_sessions")
          .select("id")
          .eq("id", body.target_id)
          .eq("user_id", userId)
          .maybeSingle();
        if (!data) return NextResponse.json({ error: "target_not_found" }, { status: 404 });
      } else if (body.target_type === "recommendation_occupation") {
        const [recommendationId, occupationId] = body.target_id.split(":");
        if (!recommendationId || !occupationId) {
          return NextResponse.json({ error: "target_not_found" }, { status: 404 });
        }
        const { data: recRow } = await supabase
          .from("recommendations")
          .select("id")
          .eq("id", recommendationId)
          .eq("user_id", userId)
          .maybeSingle();
        if (!recRow) return NextResponse.json({ error: "target_not_found" }, { status: 404 });
        const occs = await loadAllOccupations();
        if (!occs.some((o) => o.id === occupationId)) {
          return NextResponse.json({ error: "target_not_found" }, { status: 404 });
        }
      }

      // 2. Current state lookup
      const { data: existing } = await supabase
        .from("feedback")
        .select("id, thumbs_value")
        .eq("user_id", userId)
        .eq("surface", body.surface)
        .eq("target_type", body.target_type)
        .eq("target_id", body.target_id)
        .not("thumbs_value", "is", null)
        .maybeSingle();

      // 3. No-op short-circuit
      if (existing?.thumbs_value === body.thumbs_value) {
        return NextResponse.json({ ok: true, unchanged: true });
      }

      // 4. Insert / update / delete
      if (body.thumbs_value === null) {
        if (existing) {
          await supabase.from("feedback").delete().eq("id", existing.id);
        }
        track("feedback_submitted", { kind: "thumb", surface: body.surface, value: "removed" });
      } else if (existing) {
        await supabase
          .from("feedback")
          .update({
            thumbs_value: body.thumbs_value,
            metadata: body.metadata ?? {},
          })
          .eq("id", existing.id);
        track("feedback_submitted", {
          kind: "thumb",
          surface: body.surface,
          value: body.thumbs_value === 1 ? "up" : "down",
        });
      } else {
        await supabase.from("feedback").insert({
          user_id: userId,
          surface: body.surface,
          target_type: body.target_type,
          target_id: body.target_id,
          thumbs_value: body.thumbs_value,
          metadata: body.metadata ?? {},
        });
        track("feedback_submitted", {
          kind: "thumb",
          surface: body.surface,
          value: body.thumbs_value === 1 ? "up" : "down",
        });
      }
    } else {
      // NPS path — handled in Task 9
      return NextResponse.json({ error: "not_implemented" }, { status: 501 });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    Sentry.captureException(err, { tags: { route: "POST /api/feedback", kind: body.kind } });
    return NextResponse.json({ error: "internal" }, { status: 500 });
  }
}
