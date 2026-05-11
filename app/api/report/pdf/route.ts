import { createClient } from "@/lib/supabase/server";
import { getOrCreateAnonymousUserId } from "@/lib/anonymous";
import { loadReportData } from "@/lib/pdf/loadReportData";
import { renderReport } from "@/lib/pdf/render";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET() {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    const internalUserId = await getOrCreateAnonymousUserId(user?.id);

    const data = await loadReportData(internalUserId);
    if (!data) {
      return Response.json({ error: "no_recommendation" }, { status: 400 });
    }

    const buffer = await renderReport(data);
    const dateStr = new Date(data.generatedAt).toISOString().slice(0, 10).replace(/-/g, "");
    const filename = `careeros-report-${dateStr}.pdf`;

    return new Response(buffer as BodyInit, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "private, no-cache",
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[report/pdf] error", { message, stack: err instanceof Error ? err.stack : undefined });
    return Response.json({ error: "render_failed" }, { status: 500 });
  }
}
