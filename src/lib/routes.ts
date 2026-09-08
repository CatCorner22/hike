/**
 * Query-param hrefs for the detail screens.
 *
 * The static (Capacitor) build has no server to expand a dynamic path segment
 * like /trails/<id>, so every detail screen lives at a fixed path and carries
 * its subject in the query string — on the web build too: one codebase, one
 * routing scheme, no per-target link shapes to keep in sync.
 */
export function trailDetailHref(id: string): string {
  return `/trails/detail?id=${encodeURIComponent(id)}`;
}

export function planDetailHref(id: string): string {
  return `/plan/detail?id=${encodeURIComponent(id)}`;
}

export function activityDetailHref(id: string): string {
  return `/activities/detail?id=${encodeURIComponent(id)}`;
}

export function navigateHref(navId: string): string {
  return `/navigate?target=${encodeURIComponent(navId)}`;
}
