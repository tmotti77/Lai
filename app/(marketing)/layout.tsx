export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto max-w-3xl px-6 py-12 leading-relaxed">
      {children}
    </main>
  );
}
