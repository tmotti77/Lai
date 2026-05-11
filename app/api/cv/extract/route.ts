import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getOrCreateAnonymousUserId } from "@/lib/anonymous";
import { getCvUploadForUser, setExtraction } from "@/lib/db/cv";
import { buildSystemPrompt } from "@/lib/cv/prompt";
import { streamCvExtraction } from "@/lib/cv/extract";
import type { ExtractedSkill } from "@/lib/cv/types";

export const runtime = "nodejs";
export const maxDuration = 60;

const RequestSchema = z.object({
  cv_upload_id: z.uuid(),
});

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }

  const parsed = RequestSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "validation_failed" }, { status: 400 });
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const userId = await getOrCreateAnonymousUserId(user?.id);

  const upload = await getCvUploadForUser({ id: parsed.data.cv_upload_id, userId });
  if (!upload || !upload.extracted_text) {
    return Response.json({ error: "upload_not_found" }, { status: 404 });
  }

  const result = streamCvExtraction(buildSystemPrompt(), upload.extracted_text);

  // Persist the final extraction in the background. Stream is fully owned by the
  // response; this side-effect runs concurrently so the user sees the stream
  // immediately while we write reflection + skills to the DB on completion.
  void (async () => {
    try {
      const finalOutput = await result.output;
      const taxonomySkills: ExtractedSkill[] = finalOutput.skills.map((s) => ({
        id: s.id,
        confidence: s.confidence,
        evidence: s.evidence,
      }));
      await setExtraction({
        id: upload.id,
        extractedText: upload.extracted_text ?? "",
        reflectionHe: finalOutput.reflection_he,
        taxonomySkills,
        otherSkills: finalOutput.other_skills,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[cv/extract] persist_failed", { id: upload.id, message });
    }
  })();

  return result.toTextStreamResponse();
}
