import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  serverExternalPackages: [
    "@google-analytics/admin",
    "@google-analytics/data",
    "@google-cloud/firestore",
    "google-auth-library",
  ],
  experimental: {
    cpus: 1,
    webpackBuildWorker: false,
  },
};

export default nextConfig;
