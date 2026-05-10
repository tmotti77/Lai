"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/client";
import { he } from "@/lib/i18n/he";

export default function SignInPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleMagicLink(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
    });
    setLoading(false);
    if (error) setError(error.message);
    else setSent(true);
  }

  async function handleGoogle() {
    const supabase = createClient();
    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    });
  }

  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle>{he.auth.signInTitle}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {sent ? (
          <p className="text-sm text-muted-foreground">{he.auth.magicLinkSent}</p>
        ) : (
          <form onSubmit={handleMagicLink} className="flex flex-col gap-3">
            <label className="text-sm font-medium">
              {he.auth.emailLabel}
              <Input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                dir="ltr"
                className="mt-1"
              />
            </label>
            <Button type="submit" disabled={loading || !email}>
              {he.auth.sendMagicLink}
            </Button>
            {error && <p className="text-sm text-destructive">{error}</p>}
          </form>
        )}
        <div className="relative my-2">
          <div className="absolute inset-0 flex items-center">
            <span className="w-full border-t border-border" />
          </div>
        </div>
        <Button variant="outline" onClick={handleGoogle}>
          {he.auth.googleSignIn}
        </Button>
      </CardContent>
    </Card>
  );
}
