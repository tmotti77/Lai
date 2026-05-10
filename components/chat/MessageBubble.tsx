import { cn } from "@/lib/utils";

type Props = {
  role: "user" | "assistant";
  text: string;
};

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
        {text}
      </div>
    </div>
  );
}
