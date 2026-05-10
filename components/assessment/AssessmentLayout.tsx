import type { ReactNode } from "react";
import Link from "next/link";

export function AssessmentLayout({
  title,
  intro,
  children,
}: {
  title: string;
  intro: string;
  children: ReactNode;
}) {
  return (
    <div className="mx-auto flex min-h-dvh max-w-2xl flex-col gap-6 px-4 py-8">
      <Link href="/assessment" className="text-sm text-muted-foreground hover:underline">
        ← חזרה לרשימת השאלונים
      </Link>
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        <p className="text-base text-muted-foreground" dir="auto">{intro}</p>
      </header>
      <main className="flex flex-col gap-4">{children}</main>
    </div>
  );
}
