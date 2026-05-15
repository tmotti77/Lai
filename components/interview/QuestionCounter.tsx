"use client";

import { he } from "@/lib/i18n/he";

export function QuestionCounter({
  current,
  total,
  wrappingUp,
}: {
  current: number;
  total: number;
  wrappingUp?: boolean;
}) {
  if (wrappingUp) {
    return <span className="text-xs text-muted-foreground">{he.interview.counter.wrappingUp}</span>;
  }
  return (
    <span className="text-xs text-muted-foreground">
      {he.interview.counter.label
        .replace("{current}", String(current))
        .replace("{total}", String(total))}
    </span>
  );
}
