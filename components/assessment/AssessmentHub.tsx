import Link from "next/link";
import { he } from "@/lib/i18n/he";
import type { AssessmentStatusMap } from "@/lib/db/assessments";

const TYPES = [
  { type: "riasec",      href: "/assessment/riasec" },
  { type: "big5",        href: "/assessment/big5" },
  { type: "values",      href: "/assessment/values" },
  { type: "constraints", href: "/assessment/constraints" },
] as const;

export function AssessmentHub({ status }: { status: AssessmentStatusMap }) {
  const labels = he.assessment.hub.cardLabels;
  const blurbs = he.assessment.hub.cardBlurbs;
  const statusLabels = he.assessment.hub.status;

  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <header className="mb-6 space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">{he.assessment.hub.title}</h1>
        <p className="text-base text-muted-foreground">{he.assessment.hub.subtitle}</p>
      </header>
      <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {TYPES.map(({ type, href }) => {
          const done = status[type] === "completed";
          return (
            <li key={type}>
              <Link
                href={href}
                className="flex h-full flex-col justify-between rounded-lg border bg-card p-4 transition-colors hover:bg-accent"
              >
                <div>
                  <div className="text-base font-medium">{labels[type]}</div>
                  <div className="mt-1 text-sm text-muted-foreground">{blurbs[type]}</div>
                </div>
                <div
                  className={`mt-3 inline-flex w-fit rounded-full px-2 py-0.5 text-xs ${
                    done ? "bg-emerald-100 text-emerald-900 dark:bg-emerald-900/40 dark:text-emerald-100" : "bg-muted text-muted-foreground"
                  }`}
                >
                  {done ? statusLabels.completed : statusLabels.notStarted}
                </div>
              </Link>
            </li>
          );
        })}
      </ul>

      <Link
        href="/cv"
        className="mt-4 flex items-center justify-between rounded-lg border-2 border-dashed bg-card p-4 transition-colors hover:border-primary/50 hover:bg-accent"
      >
        <div>
          <div className="text-base font-medium">{he.cv.nav}</div>
          <div className="mt-1 text-sm text-muted-foreground">{he.cv.hero.subtitle}</div>
        </div>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden>
          <path d="M19 12H5m0 0l6 6m-6-6l6-6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </Link>
    </div>
  );
}
