import type { NextConfig } from "next";
import withSerwistInit from "@serwist/next";

const withSerwist = withSerwistInit({
  swSrc: "src/sw.ts",
  swDest: "public/sw.js",
  // /offline is an app route, not a webpack static asset. Listing it makes
  // Serwist fetch and precache the real fallback document during install.
  additionalPrecacheEntries: [{ url: "/offline", revision: null }],
  disable: process.env.NODE_ENV === "development",
});

const nextConfig: NextConfig = {
  transpilePackages: ["maplibre-gl"],
};

export default withSerwist(nextConfig);
