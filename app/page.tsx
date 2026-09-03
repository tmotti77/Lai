import Link from "next/link";
import { he } from "@/lib/i18n/he";

export default function HomePage() {
  const { home } = he;

  return (
    <div className="min-h-dvh">
      {/* Hero Section */}
      <section className="mx-auto flex min-h-[70vh] max-w-4xl flex-col items-center justify-center gap-6 px-6 py-16 text-center">
        <h1 className="text-5xl font-bold tracking-tight sm:text-6xl">
          {home.hero.title}
        </h1>
        <p className="max-w-2xl text-lg text-muted-foreground sm:text-xl">
          {home.hero.subtitle}
        </p>
        <p className="max-w-3xl text-base leading-relaxed text-muted-foreground">
          {home.hero.description}
        </p>
        <Link
          href="/chat"
          className="mt-4 rounded-lg bg-primary px-8 py-4 text-lg font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
        >
          {home.hero.cta}
        </Link>
        <div className="mt-4 flex flex-wrap items-center justify-center gap-4 text-sm">
          <Link href="/assessment" className="text-muted-foreground underline-offset-4 hover:underline">
            {home.nav.assessments}
          </Link>
          <span className="text-muted-foreground/40">•</span>
          <Link href="/cv" className="text-muted-foreground underline-offset-4 hover:underline">
            {home.nav.cv}
          </Link>
          <span className="text-muted-foreground/40">•</span>
          <Link href="/recommendations" className="text-muted-foreground underline-offset-4 hover:underline">
            {home.nav.recommendations}
          </Link>
          <span className="text-muted-foreground/40">•</span>
          <Link href="/interview" className="text-muted-foreground underline-offset-4 hover:underline">
            {home.nav.interview}
          </Link>
        </div>
      </section>

      {/* How It Works */}
      <section className="border-t bg-muted/30 px-6 py-16">
        <div className="mx-auto max-w-5xl">
          <h2 className="mb-12 text-center text-3xl font-bold">
            {home.howItWorks.title}
          </h2>
          <div className="grid gap-8 sm:grid-cols-3">
            {home.howItWorks.steps.map((step) => (
              <div key={step.number} className="flex flex-col items-center text-center">
                <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-primary text-2xl font-bold text-primary-foreground">
                  {step.number}
                </div>
                <h3 className="mb-2 text-xl font-semibold">{step.title}</h3>
                <p className="text-sm leading-relaxed text-muted-foreground">
                  {step.description}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Features / Who Is It For */}
      <section className="px-6 py-16">
        <div className="mx-auto max-w-5xl">
          <h2 className="mb-12 text-center text-3xl font-bold">
            {home.features.title}
          </h2>
          <div className="grid gap-8 sm:grid-cols-3">
            {home.features.items.map((item, i) => (
              <div key={i} className="flex flex-col items-center text-center">
                <div className="mb-4 text-5xl">{item.icon}</div>
                <h3 className="mb-2 text-xl font-semibold">{item.title}</h3>
                <p className="text-sm leading-relaxed text-muted-foreground">
                  {item.description}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Bottom CTA */}
      <section className="border-t bg-muted/30 px-6 py-16">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="mb-4 text-3xl font-bold">{home.cta.title}</h2>
          <p className="mb-6 text-base text-muted-foreground">
            {home.cta.description}
          </p>
          <Link
            href="/chat"
            className="inline-block rounded-lg bg-primary px-8 py-4 text-lg font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
          >
            {home.cta.button}
          </Link>
        </div>
      </section>

      {/* Footer Disclaimer */}
      <footer className="border-t px-6 py-8 text-center text-xs text-muted-foreground">
        {he.disclaimer.short}
      </footer>
    </div>
  );
}
