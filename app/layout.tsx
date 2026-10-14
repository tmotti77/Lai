import type { Metadata } from "next";
import { Heebo } from "next/font/google";
import { ConsentedAnalytics } from "@/components/cookie-consent/ConsentedAnalytics";
import { CookieBanner } from "@/components/cookie-consent/CookieBanner";
import { Toaster } from "@/components/ui/sonner";
import "./globals.css";

const heebo = Heebo({
  subsets: ["hebrew", "latin"],
  display: "swap",
  variable: "--font-heebo",
});

export const metadata: Metadata = {
  title: "CareerOS — מערכת הפעלה לקריירה שלך",
  description: "סוכן AI שעוזר לך להבין איזה כיוון מקצועי מתאים לך באמת.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="he" dir="rtl" className={heebo.variable}>
      <body className="flex h-dvh flex-col bg-background font-sans text-foreground antialiased">
        <CookieBanner />
        <div className="min-h-0 flex-1 overflow-auto">{children}</div>
        <Toaster position="top-center" dir="rtl" />
        {/* Client trackers mount only through this wrapper (#63) — never import @vercel/analytics directly. */}
        <ConsentedAnalytics />
      </body>
    </html>
  );
}
