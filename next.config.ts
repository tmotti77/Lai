import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // pdf-parse v2 internally imports pdfjs-dist with a worker model that
  // Next.js's bundler cannot resolve. Marking these as external tells Next
  // to load them via Node's runtime resolution instead of bundling them.
  serverExternalPackages: ["pdf-parse", "pdfjs-dist"],
};

export default nextConfig;
