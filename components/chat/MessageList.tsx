"use client";

import type { UIMessage } from "ai";
import { useEffect, useRef } from "react";
import { MessageBubble } from "./MessageBubble";

export function MessageList({ messages }: { messages: UIMessage[] }) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

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
