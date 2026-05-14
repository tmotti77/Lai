"use client";

import { he } from "@/lib/i18n/he";

export function InterviewMessage({
  role,
  content,
}: {
  role: "user" | "assistant" | "system";
  content: string;
}) {
  if (role === "system") return null;
  const isUser = role === "user";
  return (
    <div className={`flex ${isUser ? "justify-start" : "justify-end"}`}>
      <div
        className={`max-w-[80%] rounded-2xl px-4 py-2 text-sm leading-relaxed ${
          isUser ? "bg-primary text-primary-foreground" : "bg-card border"
        }`}
      >
        <div className="mb-1 text-xs opacity-70">
          {isUser ? he.interview.chat.youSaid : he.interview.chat.interviewer}
        </div>
        <div dir="auto" className="whitespace-pre-wrap">
          {content}
        </div>
      </div>
    </div>
  );
}
