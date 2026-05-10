import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getOrCreateAnonymousUserId } from "@/lib/anonymous";
import { saveAssessment } from "@/lib/db/assessments";
import { scoreRiasec } from "@/lib/assessment/riasec/score";
import { RIASEC_ITEMS_VERSION, RIASEC_ITEMS } from "@/lib/assessment/riasec/items";
import { scoreBig5 } from "@/lib/assessment/big5/score";
import { BIG5_ITEMS_VERSION, BIG5_ITEMS } from "@/lib/assessment/big5/items";
import { scoreValues } from "@/lib/assessment/values/score";
import { VALUES_OPTIONS_VERSION } from "@/lib/assessment/values/options";
import { ConstraintsSchema, CONSTRAINTS_VERSION } from "@/lib/assessment/constraints/schema";

export const runtime = "nodejs";

const LikertResponses = z.record(z.string(), z.number().int().min(1).max(5));

const SubmitSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("riasec"), responses: LikertResponses }),
  z.object({ type: z.literal("big5"), responses: LikertResponses }),
  z.object({
    type: z.literal("values"),
    responses: z.object({
      picked: z.array(z.string()).length(5),
      ranked: z.array(z.string()).length(3),
    }),
  }),
  z.object({ type: z.literal("constraints"), responses: ConstraintsSchema }),
]);

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }

  const parsed = SubmitSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: "validation_failed", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const submission = parsed.data;

  // Pre-check completeness for the likert assessments before opening a DB
  // connection. Bad client requests fail-fast without a Supabase round-trip.
  if (submission.type === "riasec") {
    const expected = new Set(RIASEC_ITEMS.map((i) => i.id));
    const got = new Set(Object.keys(submission.responses));
    if (got.size !== expected.size || ![...expected].every((id) => got.has(id))) {
      return Response.json({ error: "incomplete_riasec" }, { status: 400 });
    }
  }
  if (submission.type === "big5") {
    const expected = new Set(BIG5_ITEMS.map((i) => i.id));
    const got = new Set(Object.keys(submission.responses));
    if (got.size !== expected.size || ![...expected].every((id) => got.has(id))) {
      return Response.json({ error: "incomplete_big5" }, { status: 400 });
    }
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const internalUserId = await getOrCreateAnonymousUserId(user?.id);

  try {
    let scores: unknown;
    let itemsVersion: number;

    switch (submission.type) {
      case "riasec": {
        scores = scoreRiasec(submission.responses, RIASEC_ITEMS_VERSION);
        itemsVersion = RIASEC_ITEMS_VERSION;
        break;
      }
      case "big5": {
        scores = scoreBig5(submission.responses, BIG5_ITEMS_VERSION);
        itemsVersion = BIG5_ITEMS_VERSION;
        break;
      }
      case "values": {
        scores = scoreValues(submission.responses, VALUES_OPTIONS_VERSION);
        itemsVersion = VALUES_OPTIONS_VERSION;
        break;
      }
      case "constraints": {
        scores = submission.responses; // no derived score; the form IS the score
        itemsVersion = CONSTRAINTS_VERSION;
        break;
      }
    }

    const saved = await saveAssessment({
      userId: internalUserId,
      type: submission.type,
      responses: submission.responses,
      scores,
      itemsVersion,
    });

    return Response.json({ id: saved.id, takenAt: saved.takenAt, scores });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: "scoring_failed", message }, { status: 400 });
  }
}
