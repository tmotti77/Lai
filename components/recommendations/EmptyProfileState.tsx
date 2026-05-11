import Link from "next/link";
import { he } from "@/lib/i18n/he";
import { Button } from "@/components/ui/button";

export function EmptyProfileState() {
  const t = he.recommendations.emptyProfile;
  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-4 rounded-xl border bg-card p-8 text-center">
      <h2 className="text-xl font-semibold">{t.title}</h2>
      <p className="text-sm text-muted-foreground">{t.body}</p>
      <div className="flex gap-2">
        <Button asChild><Link href="/chat">{t.ctaChat}</Link></Button>
        <Button asChild variant="outline"><Link href="/assessment">{t.ctaAssess}</Link></Button>
      </div>
    </div>
  );
}
