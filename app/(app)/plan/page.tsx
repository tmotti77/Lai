import { he } from "@/lib/i18n/he";
import { PlanClient } from "@/components/plan/PlanClient";

export const dynamic = "force-dynamic";

export default function PlanPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <header className="mb-6 space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">{he.plan.title}</h1>
        <p className="text-base text-muted-foreground">{he.plan.subtitle}</p>
      </header>
      <PlanClient />
    </div>
  );
}
