import type { NextConfig } from "next";
import bundleAnalyzer from "@next/bundle-analyzer";
import path from "node:path";

const withBundleAnalyzer = bundleAnalyzer({
  enabled: process.env.ANALYZE === "true",
});

const nextConfig: NextConfig = {
  typedRoutes: true,
  cacheComponents: true,
  partialPrefetching: true,
  reactCompiler: {
    compilationMode: "annotation",
  },
  experimental: {
    turbopackRustReactCompiler: true,
    // Keep the new experimental cache/compiler behavior in local development.
    turbopackGc: process.env.NODE_ENV === "development",
    turbopackLazyDynamicImports: process.env.NODE_ENV === "development",
  },
  turbopack: {
    root: path.resolve(process.cwd()),
  },
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "lh3.googleusercontent.com",
      },
      {
        protocol: "https",
        hostname: "static.giinfotech.ae"
      }
    ],
    minimumCacheTTL: 60 * 60 * 24 * 365, // 1 yearnp
    deviceSizes: [640, 750, 828, 1080, 1200, 1920, 2048, 3840],
    imageSizes: [16, 32, 48, 64, 96, 128, 256, 384],
  },
};

export default withBundleAnalyzer(nextConfig);
