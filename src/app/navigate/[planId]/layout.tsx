import type { ReactNode } from "react";

/**
 * Stamp the requested route id into the server-rendered document.
 *
 * The navigation page is a client component and its first server render is a
 * loading state.  Offline preparation fetches that HTML before hydration, so
 * the route identity must live in a server layout rather than only in the
 * eventual map UI.  The cache validator refuses generic Next soft-error pages
 * unless this exact marker is present.
 */
export default async function NavigateRouteLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ planId: string }>;
}) {
  const { planId } = await params;

  return (
    <div className="contents" data-hike-navigate-shell={planId}>
      {children}
    </div>
  );
}
