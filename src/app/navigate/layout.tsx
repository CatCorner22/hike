import type { ReactNode } from "react";
import { NAVIGATE_SHELL_ROUTE_ID } from "@/lib/offline/navigate-shell-validation";

/**
 * Stamp the navigate shell marker into the server-rendered document.
 *
 * The navigation page is a client component and its first server render is a
 * loading state.  Offline preparation fetches that HTML before hydration, so
 * the shell identity must live in a server layout rather than only in the
 * eventual map UI.  The cache validator refuses generic Next soft-error pages
 * unless this exact marker is present.
 *
 * The value is a constant, not a plan id: with ?target= routing one prerendered
 * document serves every plan, so the marker proves "navigate app shell", and
 * per-plan readiness is the route pack in IndexedDB, checked separately.
 */
export default function NavigateRouteLayout({ children }: { children: ReactNode }) {
  return (
    <div className="contents" data-hike-navigate-shell={NAVIGATE_SHELL_ROUTE_ID}>
      {children}
    </div>
  );
}
