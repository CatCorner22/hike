import { getPlatformAdapters } from "@/lib/platform/adapters";

/**
 * The overdue alarm that fires with the phone locked and the app closed.
 *
 * On the web this is honestly impossible — a JavaScript interval dies when iOS
 * suspends the tab, which is why the in-app overdue banner exists — so with no
 * adapter registered this module reports "unsupported" and changes nothing. The
 * Capacitor shell registers a NotificationsAdapter (LocalNotifications), and the
 * profile save path calls `syncOverdueNotification` every time the return time
 * changes. This is the headline safety win of the native port: the alarm a
 * solo hiker's phone raises on its own.
 *
 * One fixed id, always cancel-then-schedule: there is exactly one return-time
 * alarm, and a stale one from a previous trip must never survive a change.
 */
export const OVERDUE_NOTIFICATION_ID = 424_242;

export type OverdueNotificationSync =
  | { status: "scheduled"; atMs: number }
  | { status: "cleared" }
  | { status: "unsupported" }
  | { status: "failed" };

/**
 * Every sync runs to completion before the next one starts.
 *
 * The two callers are `void syncOverdueNotification(...)` inside the profile
 * writer, driven by a `datetime-local` onChange — so a picker spin or a key
 * autorepeat that crosses a valid/invalid boundary emits set-then-clear pairs
 * milliseconds apart, each starting an independent chain. The two chains are
 * not the same length: a clear is one bridge hop (`cancel`), while a set is
 * four (permissions, cancel, the plugin's own cancel, schedule). Unserialized,
 * a later-issued clear overtakes an earlier-issued set and the set's schedule
 * lands after the clear's cancel — the store says no deadline while the phone
 * stays armed on one the hiker just deleted, or armed on a time they scrolled
 * past. That is exactly the invariant the docblock above claims to enforce.
 *
 * Chaining is the whole fix: the last-issued sync executes last, so the store
 * and the phone converge on the newest deadline. The wait stays off the write
 * path — callers still fire and forget, and the panel's message is about
 * storage, which has already succeeded by then.
 */
let queue: Promise<unknown> = Promise.resolve();

/**
 * The outcome of the most recent sync, and a way to watch it.
 *
 * Callers fire and forget — deliberately, because the panel's "Deadline: …"
 * message is about STORAGE and must not wait on three bridge hops. But the
 * outcome still matters: the App Store listing promises "a return-time alarm
 * fires on the phone itself, even with the app closed", and a hiker who tapped
 * "Don't Allow" on the notification prompt gets no alarm and, until now, no
 * word of it. `unsupported` is the honest steady state on the web and is not a
 * problem to report; `failed` means the phone refused something it can do.
 */
let lastSync: OverdueNotificationSync = { status: "unsupported" };
const syncListeners = new Set<(sync: OverdueNotificationSync) => void>();

export function lastOverdueNotificationSync(): OverdueNotificationSync {
  return lastSync;
}

export function subscribeOverdueNotification(
  listener: (sync: OverdueNotificationSync) => void,
): () => void {
  syncListeners.add(listener);
  return () => {
    syncListeners.delete(listener);
  };
}

export function syncOverdueNotification(
  returnAt: Date | string | null,
  now = Date.now(),
): Promise<OverdueNotificationSync> {
  const run = queue.then(async () => {
    const result = await runOverdueSync(returnAt, now);
    lastSync = result;
    for (const listener of [...syncListeners]) listener(result);
    return result;
  });
  // A failed sync must not poison the queue for the ones behind it.
  queue = run.catch(() => undefined);
  return run;
}

/** Test-only: forget the last outcome and any watchers. */
export function __resetOverdueNotificationForTests(): void {
  lastSync = { status: "unsupported" };
  syncListeners.clear();
  queue = Promise.resolve();
}

async function runOverdueSync(
  returnAt: Date | string | null,
  now: number,
): Promise<OverdueNotificationSync> {
  const adapter = getPlatformAdapters().notifications;
  if (!adapter) return { status: "unsupported" };

  let atMs: number | null = null;
  if (returnAt != null) {
    atMs = returnAt instanceof Date ? returnAt.getTime() : Date.parse(returnAt);
    if (!Number.isFinite(atMs)) atMs = null;
  }

  try {
    // Cancel first in every branch: a cleared or replaced deadline must never leave
    // the previous alarm armed.
    await adapter.cancel(OVERDUE_NOTIFICATION_ID);
    if (atMs == null) return { status: "cleared" };
    if (atMs <= now) {
      // Already past: the in-app overdue state owns "late now"; a notification
      // scheduled in the past either fires instantly (a duplicate alarm) or is
      // dropped silently depending on the platform — neither is trustworthy.
      return { status: "cleared" };
    }
    const scheduled = await adapter.scheduleAt(
      OVERDUE_NOTIFICATION_ID,
      atMs,
      "Return time reached",
      "You are past your planned return time. Check in as OK, or start your emergency steps.",
    );
    return scheduled ? { status: "scheduled", atMs } : { status: "failed" };
  } catch {
    return { status: "failed" };
  }
}
