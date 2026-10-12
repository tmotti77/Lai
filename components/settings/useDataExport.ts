"use client";

import { useCallback, useRef, useState } from "react";
import { toast } from "sonner";
import { he } from "@/lib/i18n/he";
import { exportErrorMessage } from "./messages";

const FALLBACK_FILENAME = "careeros-export.json";

function filenameFrom(contentDisposition: string | null): string {
  const match = contentDisposition?.match(/filename="?([^";]+)"?/i);
  return match?.[1] ?? FALLBACK_FILENAME;
}

/**
 * GET /api/me/export as a download. One instance per page: DataRightsPanel owns it and
 * passes it to the delete dialog, so an export in flight blocks deletion (#51 critique #4).
 */
export function useDataExport(): { exporting: boolean; start: () => Promise<void> } {
  const [exporting, setExporting] = useState(false);
  // State updates are async; the ref stops a double click from sending two requests.
  const inFlight = useRef(false);

  const start = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setExporting(true);
    try {
      const res = await fetch("/api/me/export", { cache: "no-store" });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string; retry_after_s?: number };
        toast.error(exportErrorMessage(res.status, body.error, body.retry_after_s));
        return;
      }
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement("a");
      a.href = url;
      a.download = filenameFrom(res.headers.get("content-disposition"));
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast.success(he.settings.export.success);
    } catch {
      toast.error(he.settings.export.errors.generic);
    } finally {
      inFlight.current = false;
      setExporting(false);
    }
  }, []);

  return { exporting, start };
}
