"use client";

import type { UIMessage } from "ai";
import { useEffect, useRef } from "react";
import { MessageBubble } from "./MessageBubble";

export function MessageList({ messages }: { messages: UIMessage[] }) {
  const bottomRef = useRef<HTMLDivElement>(null);

  // Re-fire scroll on every text-content change, not just when a new message
  // is appended. Without this dependency, long streaming responses appear
  // "frozen" because tokens arrive below the viewport as the bubble grows
  // but messages.length stays the same — the bottom marker never re-scrolls.
  const lastMessage = messages[messages.length - 1];
  const lastMessageTextLength = lastMessage
    ? lastMessage.parts.reduce(
        (sum, p) => sum + (p.type === "text" ? p.text.length : 0),
        0,
      )
    : 0;

  useEffect(() => {
    // requestAnimationFrame batches multiple token updates within one paint
    // and prevents conflicting scroll animations stacking up.
    const raf = requestAnimationFrame(() => {
      bottomRef.current?.scrollIntoView({ block: "end", behavior: "instant" });
    });
    return () => cancelAnimationFrame(raf);
  }, [messages.length, lastMessageTextLength]);

  return (
    <div className="flex flex-col gap-3 overflow-y-auto px-4 py-6">
      {messages.map((m) => {
        const text = m.parts
          .map((p) => (p.type === "text" ? p.text : ""))
          .join("");
        if (!text) return null;
        return (
          <MessageBubble
            key={m.id}
            role={m.role as "user" | "assistant"}
            text={text}
          />
        );
      })}
      <div ref={bottomRef} />
    </div>
  );
}
