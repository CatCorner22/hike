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

/**
 * One codebase, two build outputs.
 *
 * The web build is the deployed PWA: Serwist service worker, cookie minting in
 * src/proxy.ts, security headers, API route handlers. BUILD_TARGET=capacitor
 * produces the static shell the iOS app bundles: `output: "export"`, no server
 * pieces. Server-only files are excluded by extension — API route handlers are
 * named route.api.ts, which only the web build's pageExtensions recognize.
 * (The proxy CANNOT use that trick: Next's proxy detection compares
 * `path.parse(file).name === "proxy"`, and a compound extension makes the name
 * "proxy.api" — so proxy.ts keeps its name and the capacitor build script
 * moves it aside for the duration of the export instead.)
 */
const isCapacitorBuild = process.env.BUILD_TARGET === "capacitor";

const sharedConfig: NextConfig = {
  transpilePackages: ["maplibre-gl"],
};

const webConfig: NextConfig = {
  ...sharedConfig,
  pageExtensions: ["api.ts", "api.tsx", "ts", "tsx"],
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

const capacitorConfig: NextConfig = {
  ...sharedConfig,
  // No "api.ts": route handlers do not exist for the static shell. The app
  // talks to the deployed API over HTTPS with a bearer token instead.
  pageExtensions: ["ts", "tsx"],
  output: "export",
  trailingSlash: true,
  images: { unoptimized: true },
  // No headers(): a static export has no server to send them. The shell's CSP
  // ships as a <meta http-equiv> tag in the layout for capacitor builds.
};

// No Serwist for the native shell: assets are bundled with the app, and a web
// service worker inside WKWebView would only fight the bundle.
export default isCapacitorBuild ? capacitorConfig : withSerwist(webConfig);
