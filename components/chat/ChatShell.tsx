"use client";

import Link from "next/link";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import { DisclaimerBanner } from "./DisclaimerBanner";
import { MessageList } from "./MessageList";
import { InputBar } from "./InputBar";
import { ConsentDialog } from "./ConsentDialog";
import { he } from "@/lib/i18n/he";

export function ChatShell({ initialMessages = [] }: { initialMessages?: UIMessage[] }) {
  const { messages, sendMessage, status, error } = useChat({
    transport: new DefaultChatTransport({ api: "/api/chat" }),
    messages: initialMessages,
  });

  const isLoading = status === "submitted" || status === "streaming";
  const isResumed = initialMessages.length > 0;

  return (
    <div className="mx-auto flex h-dvh max-w-2xl flex-col">
      <ConsentDialog />
      <DisclaimerBanner />
      <header className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
        <h1 className="text-base font-semibold">{he.chat.headerTitle}</h1>
        <nav className="flex items-center gap-3 text-sm text-muted-foreground">
          <Link href="/assessment" className="hover:text-foreground transition-colors">
            {he.chat.nav.assessment}
          </Link>
          <Link href="/cv" className="hover:text-foreground transition-colors">
            {he.chat.nav.cv}
          </Link>
          <Link href="/recommendations" className="hover:text-foreground transition-colors">
            {he.chat.nav.recommendations}
          </Link>
        </nav>
      </header>

      {messages.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
          <h2 className="text-2xl font-bold">{he.chat.emptyState.title}</h2>
          <p className="text-muted-foreground">{he.chat.emptyState.body}</p>
        </div>
      ) : (
        <div className="flex-1 overflow-hidden">
          {isResumed && (
            <div className="border-b border-border bg-muted/30 px-4 py-1 text-center text-xs text-muted-foreground">
              {he.chat.resumed}
            </div>
          )}
          <MessageList
            messages={messages}
            isTyping={
              isLoading &&
              messages[messages.length - 1]?.role === "user"
            }
          />
        </div>
      )}

      {error && (
        <div className="border-t border-destructive bg-destructive/10 px-4 py-2 text-sm text-destructive">
          {he.chat.error.generic}
        </div>
      )}

      <InputBar
        onSubmit={(text) => sendMessage({ text })}
        disabled={isLoading}
      />
    </div>
  );
}
