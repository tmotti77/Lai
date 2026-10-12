"use client";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { he } from "@/lib/i18n/he";
import { DeleteAccountDialog } from "./DeleteAccountDialog";
import { useDataExport } from "./useDataExport";

export function DataRightsPanel({ isAnonymous }: { isAnonymous: boolean }) {
  const s = he.settings;
  // The single export state for the page; the dialog's "export first" button shares it.
  const { exporting, start } = useDataExport();

  return (
    <div className="space-y-6">
      <Card className="space-y-3 p-6">
        <h2 className="text-lg font-semibold">{s.export.heading}</h2>
        <p className="text-sm text-muted-foreground">{s.export.description}</p>
        <Button onClick={() => void start()} disabled={exporting} aria-busy={exporting}>
          {exporting ? s.export.loading : s.export.button}
        </Button>
      </Card>

      <Card className="space-y-3 border-destructive/40 p-6">
        <h2 className="text-lg font-semibold">{s.delete.heading}</h2>
        <p className="text-sm text-muted-foreground">{s.delete.description}</p>
        <DeleteAccountDialog isAnonymous={isAnonymous} exporting={exporting} onExportAction={start} />
      </Card>
    </div>
  );
}
