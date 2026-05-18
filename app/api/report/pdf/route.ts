import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { getOrCreateAnonymousUserId } from "@/lib/anonymous";
import { requireConsent, NoConsentError } from "@/lib/consent";
import { loadReportData } from "@/lib/pdf/loadReportData";
import { renderReport } from "@/lib/pdf/render";
import { track } from "@/lib/analytics";
import { markNpsEligibilityIfFirst } from "@/lib/db/nps";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET() {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    const internalUserId = await getOrCreateAnonymousUserId(user?.id);

    try {
      await requireConsent(internalUserId);
    } catch (err) {
      if (err instanceof NoConsentError) {
        return Response.json({ error: "consent_required" }, { status: 403 });
      }
      throw err;
    }

    const data = await loadReportData(internalUserId);
    if (!data) {
      return Response.json({ error: "no_recommendation" }, { status: 400 });
    }

    const buffer = await renderReport(data);

    const svc = createServiceClient();
    const { data: affectedRows, error: updateErr } = await svc
      .from("users")
      .update({ first_report_downloaded_at: new Date().toISOString() })
      .eq("id", internalUserId)
      .is("first_report_downloaded_at", null)
      .select("id");

    const isFirst = !updateErr && (affectedRows?.length ?? 0) === 1;
    track("report_downloaded", { is_first: isFirst });

    if (isFirst) {
      await markNpsEligibilityIfFirst(internalUserId, "pdf_download");
    }

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
