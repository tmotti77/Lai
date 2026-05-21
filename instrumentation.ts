// instrumentation.ts
// Sentry is gated on NODE_ENV === "production" to avoid the @sentry/node-core
// + require-in-the-middle transitive dep crashing under Turbopack in dev.
// Sentry is already disabled in dev via `enabled: NODE_ENV === "production"` in
// sentry.{server,edge}.config.ts, so skipping the import here costs nothing
// observability-wise while fixing dev startup.

export async function register() {
  if (process.env.NODE_ENV !== "production") return;
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./sentry.server.config");
  }
  if (process.env.NEXT_RUNTIME === "edge") {
    await import("./sentry.edge.config");
  }
}

type CaptureRequestErrorArgs = Parameters<
  typeof import("@sentry/nextjs").captureRequestError
>;

export async function onRequestError(...args: CaptureRequestErrorArgs) {
  if (process.env.NODE_ENV !== "production") return;
  const { captureRequestError } = await import("@sentry/nextjs");
  return captureRequestError(...args);
}
