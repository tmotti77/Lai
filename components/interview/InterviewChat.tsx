"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { he } from "@/lib/i18n/he";
import { Button } from "@/components/ui/button";
import type {
  InterviewSession,
  InterviewMessageRow,
} from "@/lib/interview/types";
import { InterviewMessage } from "./InterviewMessage";
import { QuestionCounter } from "./QuestionCounter";

const SENTINEL_START = "__start__";

interface UiMessage {
  role: "user" | "assistant";
  content: string;
  streaming?: boolean;
}

export function InterviewChat({
  session,
  initialMessages,
}: {
  session: InterviewSession;
  initialMessages: InterviewMessageRow[];
}) {
  const router = useRouter();
  const [messages, setMessages] = useState<UiMessage[]>(
    initialMessages
      .filter((m) => m.role === "user" || m.role === "assistant")
      .map((m) => ({
        role: m.role as "user" | "assistant",
        content: m.content,
      })),
  );
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [questionCount, setQuestionCount] = useState(session.question_count);
  const [wrappingUp, setWrappingUp] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const startedRef = useRef(false);

  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    if (initialMessages.length === 0) {
      void send(SENTINEL_START);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function send(message: string) {
    setSending(true);
    if (message !== SENTINEL_START) {
      setMessages((m) => [...m, { role: "user", content: message }]);
    }
    setInput("");

    try {
      const res = await fetch("/api/interview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "turn",
          sessionId: session.id,
          message,
        }),
      });
      if (!res.ok || !res.body) {
        setMessages((m) => [
          ...m,
          { role: "assistant", content: he.interview.errors.streamFailed },
        ]);
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let assistantText = "";
      setMessages((m) => [
        ...m,
        { role: "assistant", content: "", streaming: true },
      ]);

      // Stream parser: SSE frames with type:"text-delta" events.
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        for (const line of chunk.split("\n")) {
          if (!line.startsWith("data: ")) continue;
          const payload = line.slice(6).trim();
          if (!payload || payload === "[DONE]") continue;
          try {
            const evt = JSON.parse(payload) as { type: string; delta?: string };
            if (evt.type === "text-delta" && typeof evt.delta === "string") {
              assistantText += evt.delta;
              setMessages((m) => {
                const next = [...m];
                next[next.length - 1] = {
                  role: "assistant",
                  content: assistantText,
                  streaming: true,
                };
                return next;
              });
            }
          } catch {
            // ignore non-JSON frames
          }
        }
      }

      // Finalize the streaming bubble.
      setMessages((m) => {
        const next = [...m];
        next[next.length - 1] = {
          role: "assistant",
          content: assistantText,
        };
        return next;
      });

      // After turn finishes, check if session was completed (wrap_up fired).
      const histRes = await fetch("/api/interview/history");
      if (histRes.ok) {
        const hist = (await histRes.json()) as { sessions: InterviewSession[] };
        const fresh = hist.sessions.find((s) => s.id === session.id);
        if (fresh?.completed_at) {
          setWrappingUp(true);
          router.refresh();
          return;
        }
        if (fresh) setQuestionCount(fresh.question_count);
      }
    } finally {
      setSending(false);
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const text = input.trim();
    if (!text || sending) return;
    void send(text);
  }

  return (
    <div dir="rtl" className="mx-auto flex h-dvh max-w-3xl flex-col">
      <header className="flex items-center justify-between border-b p-4">
        <div>
          <div className="text-sm font-medium">{session.target_role_he}</div>
          <div className="text-xs text-muted-foreground">
            {he.interview.persona[session.persona].label}
          </div>
        </div>
        <QuestionCounter
          current={Math.min(questionCount + 1, session.max_questions)}
          total={session.max_questions}
          wrappingUp={wrappingUp}
        />
      </header>

      <div className="flex-1 space-y-3 overflow-y-auto p-4">
        {messages.map((m, i) => (
          <InterviewMessage key={i} role={m.role} content={m.content} />
        ))}
        <div ref={scrollRef} />
      </div>

      <form onSubmit={handleSubmit} className="flex gap-2 border-t p-4">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={he.interview.chat.composerPlaceholder}
          disabled={sending || wrappingUp}
          className="flex-1 rounded-md border bg-background px-3 py-2"
        />
        <Button
          type="submit"
          disabled={sending || wrappingUp || input.trim().length === 0}
        >
          {he.interview.chat.send}
        </Button>
      </form>
    </div>
  );
}
