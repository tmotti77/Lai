"use client";

import { useState, useTransition } from "react";
import { he } from "@/lib/i18n/he";
import { cn } from "@/lib/utils";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { XIcon } from "lucide-react";

type Props = {
  trigger: "pdf_download" | "plan_generated" | "interview_completed";
};

export function NpsPrompt({ trigger }: Props) {
  const [score, setScore] = useState<number | null>(null);
  const [comment, setComment] = useState("");
  const [hidden, setHidden] = useState(false);
  const [pending, startTransition] = useTransition();

  if (hidden) return null;

  function submit() {
    if (score === null) return;
    startTransition(async () => {
      try {
        await fetch("/api/feedback", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            kind: "nps",
            nps_score: score,
            nps_trigger: trigger,
            comment_he: comment.trim() || null,
          }),
        });
        setHidden(true);
      } catch {
        // Silent fail; let the user retry next page load.
      }
    });
  }

  function dismiss() {
    setHidden(true);
    void fetch("/api/feedback/nps-dismiss", { method: "POST" });
  }

  return (
    <Card className="relative p-6 mb-6 border-primary/30">
      <button
        type="button"
        onClick={dismiss}
        aria-label={he.feedback.nps.dismissLabel}
        className="absolute top-3 end-3 inline-flex h-11 w-11 items-center justify-center rounded-md
                   text-muted-foreground hover:text-foreground
                   focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      >
        <XIcon className="h-5 w-5" />
      </button>

      <h3 className="text-lg font-semibold mb-2">{he.feedback.nps.title}</h3>
      <p className="text-sm text-muted-foreground mb-4">{he.feedback.nps.subtitle}</p>

      <div
        role="radiogroup"
        aria-label={he.feedback.nps.scaleLabel}
        className="grid grid-cols-6 gap-2 sm:grid-cols-11 mb-4"
      >
        {Array.from({ length: 11 }, (_, i) => i).map((n) => (
          <button
            key={n}
            type="button"
            role="radio"
            aria-checked={score === n}
            onClick={() => setScore(n)}
            disabled={pending}
            className={cn(
              "inline-flex h-11 w-11 items-center justify-center rounded-md text-sm font-medium",
              "border transition-colors",
              "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
              score === n
                ? "bg-primary text-primary-foreground border-primary"
                : "bg-background hover:bg-accent border-input"
            )}
          >
            {n}
          </button>
        ))}
      </div>

      <div className="flex justify-between text-xs text-muted-foreground mb-4">
        <span>{he.feedback.nps.scaleMin}</span>
        <span>{he.feedback.nps.scaleMax}</span>
      </div>

      {score !== null && (
        <div className="space-y-3 motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-top-2 motion-safe:duration-200">
          <Textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            maxLength={1000}
            placeholder={he.feedback.nps.commentPlaceholder}
            className="min-h-[80px]"
          />
          <div className="flex gap-2 justify-end">
            <Button variant="ghost" onClick={dismiss} disabled={pending}>
              {he.feedback.nps.skipButton}
            </Button>
            <Button onClick={submit} disabled={pending}>
              {pending ? he.feedback.nps.submitting : he.feedback.nps.submitButton}
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}
