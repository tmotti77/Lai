import { describe, it, expect, vi } from "vitest";
import { unstable_doesMiddlewareMatch } from "next/experimental/testing/server";

// proxy.ts must keep running on pages and API routes: it bootstraps the
// co_anon cookie and refreshes the Supabase session. Pinned across the
// Next 16.3 bump (#52), whose headline advisory is a proxy bypass.
vi.mock("@/lib/supabase/middleware", () => ({ updateSession: vi.fn() }));

const proxyModule = await import("@/proxy");

function matches(url: string): boolean {
  return unstable_doesMiddlewareMatch({ config: proxyModule.config, url });
}

describe("proxy matcher", () => {
  it("exports the 16.x `proxy` function", () => {
    expect(typeof proxyModule.proxy).toBe("function");
  });

  it.each(["/", "/chat", "/recommendations", "/auth/callback", "/api/chat", "/api/consent"])(
    "runs on %s",
    (url) => {
      expect(matches(url)).toBe(true);
    },
  );

  it.each([
    "/_next/static/chunks/main.js",
    "/_next/image?url=%2Flogo.png&w=64&q=75",
    "/favicon.ico",
    "/logo.svg",
    "/images/hero.png",
    "/photo.webp",
  ])("skips static asset %s", (url) => {
    expect(matches(url)).toBe(false);
  });
});
