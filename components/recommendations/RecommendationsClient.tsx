"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { he } from "@/lib/i18n/he";
import { ThreePathsView } from "./ThreePathsView";
import { EmptyProfileState } from "./EmptyProfileState";
import { SaveReportDialog } from "./SaveReportDialog";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";
import type { Ranking, Occupation, Paths } from "@/lib/matching/types";

type ApiResponse = {
  rankings: Ranking[];
  paths: Paths;
  prose: Record<string, string>;
  cached: boolean;
  generated_at?: string;
  error?: string;
};

export function RecommendationsClient({ occupations }: { occupations: Occupation[] }) {
  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isSignedIn, setIsSignedIn] = useState(false);
  const [saveDialogOpen, setSaveDialogOpen] = useState(false);

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(({ data }) => setIsSignedIn(!!data.user));
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setIsSignedIn(!!session?.user);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  const fetchRecs = async (force = false) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/recommendations", {
        method: "POST",
        cache: force ? "no-store" : "default",
      });
      if (!res.ok) {
        setError(he.recommendations.error.generic);
        setLoading(false);
        return;
      }
      const json = (await res.json()) as ApiResponse;
      if (json.error) {
        setError(he.recommendations.error.generic);
      } else {
        setData(json);
      }
    } catch {
      setError(he.recommendations.error.generic);
    }
    setLoading(false);
  };

  useEffect(() => { fetchRecs(); }, []);

  if (loading && !data) {
    return <div className="py-16 text-center text-muted-foreground">…</div>;
  }
  if (error && !data) {
    return <div className="py-16 text-center text-sm text-destructive">{error}</div>;
  }
  if (!data || data.rankings.length === 0) return <EmptyProfileState />;

  const cachedNote = data.cached && data.generated_at
    ? he.recommendations.cachedNote.replace("{when}", new Date(data.generated_at).toLocaleDateString("he-IL"))
    : null;

  return (
    <div className="space-y-4">
      {cachedNote && (
        <div className="flex items-center justify-between rounded-md border bg-muted/30 px-3 py-2 text-sm">
          <span>{cachedNote}</span>
          <Button size="sm" variant="ghost" onClick={() => fetchRecs(true)}>{he.recommendations.regenerate}</Button>
        </div>
      )}
      {data.rankings.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border bg-card px-3 py-2 text-sm">
          <div className="text-muted-foreground">
            {isSignedIn ? (
              <span className="inline-flex items-center gap-1">
                <span aria-hidden>✓</span>
                {he.recommendations.saveReport.alreadySaved}
              </span>
            ) : (
              he.report.title
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            {!isSignedIn && (
              <Button size="sm" onClick={() => setSaveDialogOpen(true)}>
                {he.recommendations.saveReport.cta}
              </Button>
            )}
            <Button asChild size="sm" variant="outline">
              <Link href="/plan">{he.plan.generate}</Link>
            </Button>
            <Button asChild size="sm" variant="outline">
              <a href="/api/report/pdf" download>{he.recommendations.downloadPdf}</a>
            </Button>
          </div>
        </div>
      )}
      <SaveReportDialog open={saveDialogOpen} onOpenChange={setSaveDialogOpen} />
      <ThreePathsView
        rankings={data.rankings}
        paths={data.paths}
        occupations={occupations}
        prose={data.prose}
      />
    </div>
  );
}
