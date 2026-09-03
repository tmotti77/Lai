import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

const nextConfig: NextConfig = {
  // unpdf is serverless-native and requires no canvas polyfills. It uses
  // pdfjs-dist's text-only extraction path (no rendering). Mark it external
  // so Next.js loads it via Node resolution rather than bundling.
  serverExternalPackages: ["unpdf"],
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
