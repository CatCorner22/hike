import type { CapacitorConfig } from "@capacitor/cli";

/**
 * The iOS shell bundles the static export (out/) and talks to the deployed API
 * over HTTPS with a bearer token — see src/lib/api/client.ts. The appId is the
 * reverse-DNS bundle identifier; changing it after TestFlight/App Store
 * submission creates a NEW app, so treat it as permanent once enrolled.
 */
const config: CapacitorConfig = {
  appId: "com.blakereagan.klandagi",
  appName: "Klandagi",
  webDir: "out",
  ios: {
    // The web core already renders its own offline/loading states; a native
    // splash lingering on top of them just hides the app's honest signals.
    contentInset: "always",
  },
};

export default config;
