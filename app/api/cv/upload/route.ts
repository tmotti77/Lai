import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { getOrCreateAnonymousUserId } from "@/lib/anonymous";
import { extractText } from "@/lib/cv/parse";
import { createCvUpload, setExtraction } from "@/lib/db/cv";
import {
  ACCEPTED_MIME_TYPES,
  MAX_FILE_SIZE_BYTES,
} from "@/lib/cv/types";
import { requireConsent, NoConsentError } from "@/lib/consent";

export const runtime = "nodejs";
export const maxDuration = 60;

const ACCEPTED = new Set<string>(ACCEPTED_MIME_TYPES);

export async function POST(req: Request) {
  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return Response.json({ error: "invalid_form" }, { status: 400 });
  }

  const file = formData.get("file");
  if (!(file instanceof File)) {
    return Response.json({ error: "missing_file" }, { status: 400 });
  }
  if (file.size === 0) {
    return Response.json({ error: "empty_file" }, { status: 400 });
  }
  if (file.size > MAX_FILE_SIZE_BYTES) {
    return Response.json({ error: "file_too_large" }, { status: 400 });
  }
  if (!ACCEPTED.has(file.type)) {
    return Response.json({ error: "unsupported_type", got: file.type }, { status: 400 });
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const userId = await getOrCreateAnonymousUserId(user?.id);

  try {
    await requireConsent(userId);
  } catch (e) {
    if (e instanceof NoConsentError) {
      return Response.json({ error: "no_consent" }, { status: 403 });
    }
    throw e;
  }

  const buffer = Buffer.from(await file.arrayBuffer());

  let parsed;
  try {
    parsed = await extractText(buffer, file.type);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message === "empty_text") {
      return Response.json({ error: "empty_text" }, { status: 422 });
    }
    return Response.json({ error: "parse_failed", message }, { status: 422 });
  }

  const ext = file.type === "application/pdf" ? "pdf" : "docx";
  const storagePath = `${userId}/${crypto.randomUUID()}.${ext}`;

  const svc = createServiceClient();
  const { error: uploadErr } = await svc.storage
    .from("cv-uploads")
    .upload(storagePath, buffer, { contentType: file.type, upsert: false });
  if (uploadErr) {
    return Response.json({ error: "storage_failed", message: uploadErr.message }, { status: 500 });
  }

  let row;
  try {
    row = await createCvUpload({
      userId,
      storagePath,
      originalFilename: file.name,
      mimeType: file.type,
      sizeBytes: file.size,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: "db_failed", message }, { status: 500 });
  }

  // Pre-write the extracted_text. The extract route reads it back, so the user's
  // CV text is never sent back to the server again after upload — keeps the wire
  // protocol clean and avoids re-parsing.
  try {
    await setExtraction({
      id: row.id,
      extractedText: parsed.text,
      reflectionHe: "",
      taxonomySkills: [],
      otherSkills: [],
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: "db_failed", message }, { status: 500 });
  }

  return Response.json({ id: row.id, truncated: parsed.truncated });
}
