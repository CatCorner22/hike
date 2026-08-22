import type { NextConfig } from "next";
import withSerwistInit from "@serwist/next";

const withSerwist = withSerwistInit({
  swSrc: "src/sw.ts",
  swDest: "public/sw.js",
  // These are app routes, not webpack static assets. Precache both the genuine
  // failure fallback and the neutral device-saved-routes destination.
  additionalPrecacheEntries: [
    { url: "/offline", revision: null },
    { url: "/saved", revision: null },
  ],
  disable: process.env.NODE_ENV === "development",
});

const nextConfig: NextConfig = {
  transpilePackages: ["maplibre-gl"],
  async headers() {
    const contentSecurityPolicy = [
      "default-src 'self'",
      // Next's production bootstrap uses inline script/style tags. Do not add
      // unsafe-eval; MapLibre workers are handled by worker-src below.
      "script-src 'self' 'unsafe-inline'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob: https://*.maptiler.com https://*.openfreemap.org",
      "connect-src 'self' https://api.maptiler.com https://*.maptiler.com https://tiles.openfreemap.org https://*.openfreemap.org",
      "worker-src 'self' blob:",
      "font-src 'self' data:",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'",
    ].join("; ");
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: contentSecurityPolicy },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "geolocation=(self), camera=(), microphone=(), payment=(), usb=()" },
        ],
      },
      {
        source: "/api/:path*",
        headers: [{ key: "Cache-Control", value: "no-store" }],
      },
    ];
  },
};

export default withSerwist(nextConfig);
