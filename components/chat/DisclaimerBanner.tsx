import { he } from "@/lib/i18n/he";

export function DisclaimerBanner() {
  return (
    <div className="border-b border-border bg-muted/40 px-4 py-2 text-center text-xs text-muted-foreground">
      {he.disclaimer.short}
    </div>
  );
}
