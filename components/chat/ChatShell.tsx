"use client";

import Link from "next/link";
import { useState, useEffect, useRef } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import { DisclaimerBanner } from "./DisclaimerBanner";
import { MessageList } from "./MessageList";
import { InputBar } from "./InputBar";
import { ConsentDialog } from "./ConsentDialog";
import { Button } from "@/components/ui/button";
import { he } from "@/lib/i18n/he";

type Props = {
  initialMessages?: UIMessage[];
  initialStage?: string;
};

export function ChatShell({ initialMessages = [], initialStage = "onboarding" }: Props) {
  const [currentStage, setCurrentStage] = useState<string>(initialStage);
  
  const { messages, sendMessage, status, error } = useChat({
    transport: new DefaultChatTransport({ api: "/api/chat" }),
    messages: initialMessages,
  });

  const isLoading = status === "submitted" || status === "streaming";
  const isResumed = initialMessages.length > 0;
  const showRecommendationsCta = currentStage === "complete";

  // Fetch stage after each turn completes (when loading stops)
  const prevLoadingRef = useRef(false);
  useEffect(() => {
    const wasLoading = prevLoadingRef.current;
    prevLoadingRef.current = isLoading;
    
    if (wasLoading && !isLoading && messages.length > 0) {
      fetch("/api/chat/stage")
        .then((res) => res.json())
        .then((data) => {
          if (data.stage) setCurrentStage(data.stage);
        })
        .catch(() => {
          // Ignore fetch errors — stage display is non-critical
        });
    }
  }, [isLoading, messages.length]);

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

      {showRecommendationsCta && (
        <div className="border-t border-border bg-primary/5 px-4 py-3">
          <Button asChild className="w-full">
            <Link href="/recommendations">
              לדף ההמלצות
            </Link>
          </Button>
        </div>
      )}

      <InputBar
        onSubmit={(text) => sendMessage({ text })}
        disabled={isLoading}
      />
    </div>
  );
}
