import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

const nextConfig: NextConfig = {
  // pdf-parse v2 internally imports pdfjs-dist with a worker model that
  // Next.js's bundler cannot resolve. Marking these as external tells Next
  // to load them via Node's runtime resolution instead of bundling them.
  // @napi-rs/canvas provides DOMMatrix and other canvas APIs needed by pdfjs-dist
  // in Node.js serverless environments (Vercel Functions).
  serverExternalPackages: ["pdf-parse", "pdfjs-dist", "@napi-rs/canvas"],
  // Pin Turbopack to this repo so a stray parent-dir package-lock.json doesn't
  // make it pick a wrong workspace root.
  turbopack: {
    root: __dirname,
  },
};

export default withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN, // build-time only
  silent: !process.env.CI,
  widenClientFileUpload: false, // we have no client SDK
  // Delete source maps from the build output after uploading to Sentry
  // so they are never served to end users
  sourcemaps: { deleteSourcemapsAfterUpload: true },
  webpack: { treeshake: { removeDebugLogging: true } },
});
