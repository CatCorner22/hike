import type { NextConfig } from "next";
import withSerwistInit from "@serwist/next";

/**
 * A per-build revision for the precached APP ROUTES below. With `revision: null`
 * Serwist keys them by URL alone and never refetches them, so both pages stayed
 * frozen at whatever the first service-worker install captured — their script
 * tags kept naming chunks that later deploys had already rotated away, and the
 * offline recovery surface (including the saved-routes list) went dead exactly
 * when it was needed. Any value that changes per build fixes it.
 */
const APP_ROUTE_REVISION =
  process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.BUILD_ID ?? Date.now().toString(36);

const withSerwist = withSerwistInit({
  swSrc: "src/sw.ts",
  swDest: "public/sw.js",
  // These are app routes, not webpack static assets. Precache both the genuine
  // failure fallback and the neutral device-saved-routes destination.
  additionalPrecacheEntries: [
    { url: "/offline", revision: APP_ROUTE_REVISION },
    { url: "/saved", revision: APP_ROUTE_REVISION },
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
  /**
   * Bookmarks and pinned tabs from before the query-param migration must not
   * dead-end. Each pattern deliberately excludes the new `detail` segment so
   * `/plan/detail` cannot match `/plan/:id` and redirect to itself forever.
   *
   * Web only: a static export has no server to redirect, and the shell has no
   * legacy URLs to rescue — it only ever links through the route helpers.
   */
  async redirects() {
    return [
      { source: "/trails/:id((?!detail$)[^/]+)", destination: "/trails/detail?id=:id", permanent: true },
      { source: "/plan/:id((?!detail$)[^/]+)", destination: "/plan/detail?id=:id", permanent: true },
      { source: "/activities/:id((?!detail$)[^/]+)", destination: "/activities/detail?id=:id", permanent: true },
      { source: "/navigate/:target([^/]+)", destination: "/navigate?target=:target", permanent: true },
    ];
  },
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
          /*
            The session cookie is already Secure, so it never travels in clear —
            but without HSTS the FIRST request to a bare hostname can be plain
            http, and a network that answers it can keep the user there. The
            place this app is used is a trailhead's open wifi or a café before
            the drive out, which is exactly where that happens.

            One year, subdomains included, no `preload`: preloading is a
            commitment that is hard to undo and belongs to whoever owns the
            domain, not to this config. Browsers ignore the header over plain
            http, so it costs nothing in local development.
          */
          {
            key: "Strict-Transport-Security",
            value: "max-age=31536000; includeSubDomains",
          },
          // camera=(self), not camera=(): the position-scan feature reads a QR
          // code off another hiker's screen to exchange coordinates with no
          // signal, and an empty allowlist denies the app's own origin too — so
          // getUserMedia failed with NotAllowedError no matter what the user
          // granted. Everything else stays denied, third-party frames included.
          {
            key: "Permissions-Policy",
            value: "geolocation=(self), camera=(self), microphone=(), payment=(), usb=()",
          },
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
  // Its own build dir: sharing .next with the web build meant whichever build
  // ran last was what `next start` silently served — the web server then 404'd
  // every API route because it was serving the exported shell's manifest.
  // NOTE: with output:"export" this directory IS the export destination; the
  // build script renames it to out/ afterwards so the public contract holds.
  distDir: ".next-cap",
  output: "export",
  trailingSlash: true,
  images: { unoptimized: true },
  // No headers(): a static export has no server to send them. The shell's CSP
  // ships as a <meta http-equiv> tag in the layout for capacitor builds.
};

// No Serwist for the native shell: assets are bundled with the app, and a web
// service worker inside WKWebView would only fight the bundle.
export default isCapacitorBuild ? capacitorConfig : withSerwist(webConfig);
