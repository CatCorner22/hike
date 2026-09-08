/**
 * Says what this deployment is, once, before it serves anything.
 *
 * Next calls `register` exactly once per server process and waits for it, which
 * makes it the only place a configuration problem can be stated before a request
 * has already failed because of it. Until now the app booted silently into
 * whatever state its environment left it in: no `DATABASE_URL` and no explicit
 * opt-in meant every route that saves a plan or a track answered 503, and the
 * first person to find out was a hiker at a trailhead with one bar of signal.
 *
 * This only prints. It never throws and never refuses to start — a server that
 * cannot store data can still serve the navigate shell to a phone that already
 * has its route, and taking the whole app down would take that away too.
 */
export async function register(): Promise<void> {
  // The edge runtime has no filesystem and no database; there is nothing here
  // for it to report, and importing the driver resolution would fail.
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  try {
    const { formatConfigReport } = await import("@/lib/config/environment");
    for (const line of formatConfigReport()) console.info(line);
  } catch (error) {
    console.error("[config] Could not read the configuration report.", error);
  }
}
