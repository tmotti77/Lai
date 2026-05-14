"use client";

import Link from "next/link";
import { he } from "@/lib/i18n/he";
import { Button } from "@/components/ui/button";
import type {
  InterviewSession,
  InterviewMessageRow,
} from "@/lib/interview/types";
import { InterviewMessage } from "./InterviewMessage";

export function WrapUpScreen({
  session,
  messages,
}: {
  session: InterviewSession;
  messages: InterviewMessageRow[];
}) {
  const visible = messages.filter(
    (m) => m.role === "user" || m.role === "assistant",
  );

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-2xl font-semibold">{he.interview.wrap.heading}</h1>
        <p className="text-muted-foreground">
          {he.interview.persona[session.persona].label} · {session.target_role_he}
        </p>
        {session.forced_wrap && (
          <p className="mt-2 rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
            {he.interview.wrap.forcedNote}
          </p>
        )}
      </header>

      {session.feedback_summary_he && (
        <section className="rounded-xl border bg-card p-5 text-base leading-relaxed">
          {session.feedback_summary_he}
        </section>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        {session.feedback_strengths_he && session.feedback_strengths_he.length > 0 && (
          <section>
            <h2 className="mb-2 text-sm font-medium">
              {he.interview.wrap.strengthsTitle}
            </h2>
            <ul className="space-y-1 text-sm">
              {session.feedback_strengths_he.map((s, i) => (
                <li key={i} className="list-inside list-disc">
                  {s}
                </li>
              ))}
            </ul>
          </section>
        )}
        {session.feedback_improvements_he &&
          session.feedback_improvements_he.length > 0 && (
            <section>
              <h2 className="mb-2 text-sm font-medium">
                {he.interview.wrap.improvementsTitle}
              </h2>
              <ul className="space-y-1 text-sm">
                {session.feedback_improvements_he.map((s, i) => (
                  <li key={i} className="list-inside list-disc">
                    {s}
                  </li>
                ))}
              </ul>
            </section>
          )}
      </div>

      {session.feedback_next_practice_focus_he && (
        <section className="rounded-xl border-2 border-primary/30 bg-primary/5 p-5">
          <h2 className="mb-1 text-sm font-medium">
            {he.interview.wrap.nextFocusTitle}
          </h2>
          <p className="text-base">{session.feedback_next_practice_focus_he}</p>
        </section>
      )}

      {session.feedback_per_question &&
        session.feedback_per_question.length > 0 && (
          <section>
            <h2 className="mb-3 text-sm font-medium">
              {he.interview.wrap.perQuestionTitle}
            </h2>
            <ol className="space-y-2 text-sm">
              {session.feedback_per_question.map((q) => (
                <li
                  key={q.question_number}
                  className="rounded-md bg-muted/40 p-3"
                >
                  <div className="text-xs text-muted-foreground">
                    {he.interview.wrap.questionLabel.replace("{n}", String(q.question_number))}
                  </div>
                  <div>{q.note_he}</div>
                </li>
              ))}
            </ol>
          </section>
        )}

      <details className="rounded-lg border bg-muted/30 p-4">
        <summary className="cursor-pointer text-sm font-medium">
          {he.interview.wrap.transcriptToggle}
        </summary>
        <div className="mt-4 space-y-3">
          {visible.map((m) => (
            <InterviewMessage
              key={m.id}
              role={m.role as "user" | "assistant"}
              content={m.content}
            />
          ))}
        </div>
      </details>

      <div className="flex items-center justify-between pt-4">
        <Link href="/interview">
          <Button variant="ghost">{he.interview.wrap.doneCta}</Button>
        </Link>
        <Link href="/interview">
          <Button>{he.interview.wrap.restartCta}</Button>
        </Link>
      </div>
    </div>
  );
}
