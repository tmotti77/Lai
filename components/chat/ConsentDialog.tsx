"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { he } from "@/lib/i18n/he";

export function ConsentDialog() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    void fetch("/api/consent").then(async (r) => {
      const data = (await r.json()) as { processing: boolean; disclaimer: boolean };
      if (!data.processing || !data.disclaimer) setOpen(true);
    });
  }, []);

  async function accept() {
    await fetch("/api/consent", { method: "POST" });
    setOpen(false);
  }

  return (
    <Dialog open={open} onOpenChange={() => { /* must explicitly accept */ }}>
      <DialogContent
        // Force-explicit acceptance: block Escape, backdrop, and the auto-rendered
        // close button. Users must press the "מסכים/ה" button to proceed.
        className="max-w-md [&>button]:hidden"
        onEscapeKeyDown={(e) => e.preventDefault()}
        onPointerDownOutside={(e) => e.preventDefault()}
        onInteractOutside={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>{he.consent.title}</DialogTitle>
          <DialogDescription className="text-start leading-relaxed">
            {he.consent.body}
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3 pt-2">
          <Button onClick={accept}>{he.consent.accept}</Button>
          <a href="/privacy" className="text-center text-xs text-muted-foreground underline">
            {he.consent.privacy}
          </a>
        </div>
      </DialogContent>
    </Dialog>
  );
}
