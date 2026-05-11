import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getOrCreateAnonymousUserId } from "@/lib/anonymous";
import { toggleTask } from "@/lib/db/plans";

export const runtime = "nodejs";

const BodySchema = z.object({ done: z.boolean() });

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "validation_failed" }, { status: 400 });
  }

  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    const internalUserId = await getOrCreateAnonymousUserId(user?.id);
    const result = await toggleTask({ userId: internalUserId, taskId: id, done: parsed.data.done });
    return Response.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message === "forbidden") return Response.json({ error: "forbidden" }, { status: 403 });
    return Response.json({ error: "toggle_failed" }, { status: 500 });
  }
}
