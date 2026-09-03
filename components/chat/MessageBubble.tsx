import { cn } from "@/lib/utils";
import Link from "next/link";

type Props = {
  role: "user" | "assistant";
  text: string;
};

// Normalize path: if it looks like a relative app route (starts with letter, contains /),
// add leading slash so Next Link routes correctly. Leaves absolute URLs unchanged.
// Exported for testing.
export function normalizePath(path: string): string {
  if (!path) return path;
  // Already absolute URL (http/https) or root-relative (starts with /)
  if (path.startsWith("http://") || path.startsWith("https://") || path.startsWith("/")) {
    return path;
  }
  // Relative path like "recommendations/" → "/recommendations"
  if (/^[a-z]/i.test(path)) {
    return "/" + path.replace(/\/$/, ""); // add leading slash, strip trailing
  }
  return path;
}

// Simple markdown parser: [text](url) → <Link>, **text** → <strong>
// Handles nested patterns like **[link](url)** by stripping bold markers around links.
// Normalizes relative paths (recommendations/ → /recommendations).
function parseMarkdown(text: string): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  // Combined regex: match **bold** OR [link](url)
  const regex = /\*\*([^*]+)\*\*|\[([^\]]+)\]\(([^)]+)\)/g;
  let lastIndex = 0;
  let match;

  while ((match = regex.exec(text)) !== null) {
    // Add text before the match
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }

    if (match[1]) {
      // Bold pattern: **text**
      // Check if the bold text contains a link pattern
      const boldContent = match[1];
      const linkMatch = /\[([^\]]+)\]\(([^)]+)\)/.exec(boldContent);
      if (linkMatch) {
        // **[text](url)** → just render the link without bold
        parts.push(
          <Link
            key={match.index}
            href={normalizePath(linkMatch[2])}
            className="underline hover:text-primary-foreground/80"
          >
            {linkMatch[1]}
          </Link>
        );
      } else {
        // Regular bold text
        parts.push(<strong key={match.index}>{boldContent}</strong>);
      }
    } else if (match[2] && match[3]) {
      // Link pattern: [text](url)
      parts.push(
        <Link
          key={match.index}
          href={normalizePath(match[3])}
          className="underline hover:text-primary-foreground/80"
        >
          {match[2]}
        </Link>
      );
    }

    lastIndex = match.index + match[0].length;
  }

  // Add remaining text after last match
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
        {parseMarkdown(text)}
      </div>
    </div>
  );
}
