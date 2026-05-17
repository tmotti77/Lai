"use client";
import { he } from "@/lib/i18n/he";

export function LikertRow({
  itemId,
  text,
  value,
  onChange,
}: {
  itemId: string;
  text: string;
  value: number | undefined;
  onChange: (next: number) => void;
}) {
  return (
    <div className="rounded-lg border bg-card p-4 shadow-sm">
      <p className="mb-3 text-base" dir="auto">{text}</p>
      <div className="flex items-center justify-between gap-2">
        {[1, 2, 3, 4, 5].map((n) => {
          const selected = value === n;
          return (
            <button
              key={n}
              type="button"
              aria-pressed={selected}
              aria-label={he.assessment.likert[String(n) as "1"|"2"|"3"|"4"|"5"]}
              onClick={() => onChange(n)}
              className={`flex h-11 min-w-11 flex-1 items-center justify-center rounded-md border text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 ${
                selected
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-input bg-background hover:bg-accent"
              }`}
            >
              {n}
            </button>
          );
        })}
      </div>
      <div className="mt-2 flex justify-between text-xs text-muted-foreground">
        <span>{he.assessment.likert["1"]}</span>
        <span>{he.assessment.likert["5"]}</span>
      </div>
    </div>
  );
}
