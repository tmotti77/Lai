"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { DisclaimerBanner } from "./DisclaimerBanner";
import { MessageList } from "./MessageList";
import { InputBar } from "./InputBar";
import { ConsentDialog } from "./ConsentDialog";
import { he } from "@/lib/i18n/he";

export function ChatShell() {
  const { messages, sendMessage, status, error } = useChat({
    transport: new DefaultChatTransport({ api: "/api/chat" }),
  });

  const isLoading = status === "submitted" || status === "streaming";

  return (
    <div className="mx-auto flex h-dvh max-w-2xl flex-col">
      <ConsentDialog />
      <DisclaimerBanner />
      <header className="border-b border-border px-4 py-3">
        <h1 className="text-base font-semibold">{he.chat.headerTitle}</h1>
      </header>

      {messages.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
          <h2 className="text-2xl font-bold">{he.chat.emptyState.title}</h2>
          <p className="text-muted-foreground">{he.chat.emptyState.body}</p>
        </div>
      ) : (
        <div className="flex-1 overflow-hidden">
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
