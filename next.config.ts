import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Playwright is launched at runtime by the verification route, so it must
  // stay external rather than be bundled into the server build.
  serverExternalPackages: ["@playwright/test", "playwright", "playwright-core"],
};

export default nextConfig;