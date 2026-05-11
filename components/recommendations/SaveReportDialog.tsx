"use client";

import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createClient } from "@/lib/supabase/client";
import { he } from "@/lib/i18n/he";

export function SaveReportDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = he.recommendations.saveReport.dialog;
  const [email, setEmail] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleMagicLink = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSending(true);
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback?next=/recommendations`,
      },
    });
    setSending(false);
    if (error) {
      setError(error.message);
      return;
    }
    setSent(true);
  };

  const handleGoogle = async () => {
    const supabase = createClient();
    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/auth/callback?next=/recommendations`,
      },
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t.title}</DialogTitle>
          <DialogDescription>{t.body}</DialogDescription>
        </DialogHeader>

        {sent ? (
          <p className="rounded-md bg-primary/5 p-3 text-sm text-foreground">{t.sent}</p>
        ) : (
          <>
            <form onSubmit={handleMagicLink} className="flex flex-col gap-3">
              <label className="flex flex-col gap-1.5 text-sm font-medium">
                {t.emailLabel}
                <Input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  dir="ltr"
                />
              </label>
              <Button type="submit" disabled={sending || !email}>
                {sending ? t.sending : t.sendMagicLink}
              </Button>
              {error && <p className="text-sm text-destructive">{error}</p>}
            </form>

            <div className="relative my-1">
              <div className="absolute inset-0 flex items-center">
                <span className="w-full border-t border-border" />
              </div>
              <div className="relative flex justify-center text-xs">
                <span className="bg-background px-2 text-muted-foreground">{t.or}</span>
              </div>
            </div>

            <Button variant="outline" onClick={handleGoogle}>
              {t.googleSignIn}
            </Button>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
