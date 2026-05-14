"use client";

import Link from "next/link";
import { he } from "@/lib/i18n/he";
import type { InterviewSession } from "@/lib/interview/types";

export function HistoryList({ sessions }: { sessions: InterviewSession[] }) {
  if (sessions.length === 0) {
    return <p className="text-sm text-muted-foreground">{he.interview.landing.historyEmpty}</p>;
  }
  return (
    <ul className="divide-y rounded-lg border">
      {sessions.map((s) => {
        const personaLabel = he.interview.persona[s.persona].label;
        const date = new Date(s.created_at).toLocaleDateString("he-IL", {
          day: "numeric",
          month: "short",
        });
        const status = s.completed_at ? "✓" : "…";
        return (
          <li key={s.id}>
            <Link
              href={`/interview/${s.id}`}
              className="flex items-center justify-between px-4 py-3 hover:bg-accent"
            >
              <div>
                <div className="text-sm font-medium">{s.target_role_he}</div>
                <div className="text-xs text-muted-foreground">{personaLabel}</div>
              </div>
              <div className="flex items-center gap-3 text-xs text-muted-foreground">
                <span>{date}</span>
                <span aria-label={s.completed_at ? "completed" : "in-progress"}>{status}</span>
              </div>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
