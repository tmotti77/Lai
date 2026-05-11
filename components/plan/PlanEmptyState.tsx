import Link from "next/link";
import { he } from "@/lib/i18n/he";
import { Button } from "@/components/ui/button";

export function PlanEmptyState() {
  const t = he.plan.emptyState;
  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-4 rounded-xl border bg-card p-8 text-center">
      <h2 className="text-xl font-semibold">{t.title}</h2>
      <p className="text-sm text-muted-foreground">{t.body}</p>
      <Button asChild><Link href="/recommendations">{t.cta}</Link></Button>
    </div>
  );
}
