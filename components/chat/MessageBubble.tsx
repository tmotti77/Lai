import { cn } from "@/lib/utils";
import Link from "next/link";

type Props = {
  role: "user" | "assistant";
  text: string;
};

// Simple markdown link parser: [text](url) → <Link href="url">text</Link>
// Handles both inline links and **bold [link](url)** patterns.
function parseMarkdownLinks(text: string): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  // Match markdown links: [text](url) where url can be absolute or relative
  const linkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
  let lastIndex = 0;
  let match;

  while ((match = linkRegex.exec(text)) !== null) {
    // Add text before the link
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }
    // Add the link
    const [, linkText, url] = match;
    parts.push(
      <Link
        key={match.index}
        href={url}
        className="underline hover:text-primary-foreground/80"
      >
        {linkText}
      </Link>
    );
    lastIndex = match.index + match[0].length;
  }

  // Add remaining text after last link
  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }

  return parts.length > 0 ? parts : [text];
}

export function MessageBubble({ role, text }: Props) {
  const isUser = role === "user";
  return (
    <div className={cn("flex w-full", isUser ? "justify-start" : "justify-end")}>
      <div
        dir="auto"
        className={cn(
          "max-w-[85%] whitespace-pre-wrap rounded-2xl px-4 py-2.5 text-sm leading-relaxed",
          isUser
            ? "bg-primary text-primary-foreground"
            : "bg-muted text-foreground",
        )}
      >
        {parseMarkdownLinks(text)}
      </div>
    </div>
  );
}
