"use client";

import { useState, useTransition } from "react";
import { ThumbsUpIcon, ThumbsDownIcon } from "lucide-react";
import { he } from "@/lib/i18n/he";
import { cn } from "@/lib/utils";
import * as Sentry from "@sentry/nextjs";

type Props = {
  surface: "chat" | "recommendations" | "interview";
  targetType: "message" | "recommendation_occupation" | "interview_session";
  targetId: string;
  initialValue: -1 | 1 | null;
  className?: string;
  metadata?: Record<string, string | number | boolean>;
};

export function ThumbsRow({ surface, targetType, targetId, initialValue, className, metadata }: Props) {
  const [value, setValue] = useState<-1 | 1 | null>(initialValue);
  const [pending, startTransition] = useTransition();

  function vote(next: -1 | 1) {
    const desired = value === next ? null : next;
    const prev = value;
    setValue(desired);

    startTransition(async () => {
      try {
        const res = await fetch("/api/feedback", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            kind: "thumb",
            surface,
            target_type: targetType,
            target_id: targetId,
            thumbs_value: desired,
            metadata,
          }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
      } catch (err) {
        setValue(prev);
        Sentry.captureException(err, { tags: { feature: "feedback_thumbs", surface } });
        if (process.env.NODE_ENV !== "production") console.error("[ThumbsRow] vote failed:", err);
      }
    });
  }

  return (
    <div className={cn("flex gap-1 items-center", className)}>
      <button
        type="button"
        onClick={() => vote(1)}
        aria-label={he.feedback.thumbs.upLabel}
        aria-pressed={value === 1}
        disabled={pending}
        className={cn(
          "inline-flex h-11 w-11 items-center justify-center rounded-md transition-opacity",
          "hover:opacity-100 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
          "disabled:opacity-50",
          value === 1 ? "opacity-100 text-primary" : "opacity-50"
        )}
      >
        <ThumbsUpIcon className={cn("h-5 w-5", value === 1 && "fill-current")} />
      </button>
      <button
        type="button"
        onClick={() => vote(-1)}
        aria-label={he.feedback.thumbs.downLabel}
        aria-pressed={value === -1}
        disabled={pending}
        className={cn(
          "inline-flex h-11 w-11 items-center justify-center rounded-md transition-opacity",
          "hover:opacity-100 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
          "disabled:opacity-50",
          value === -1 ? "opacity-100 text-destructive" : "opacity-50"
        )}
      >
        <ThumbsDownIcon className={cn("h-5 w-5", value === -1 && "fill-current")} />
      </button>
    </div>
  );
}
