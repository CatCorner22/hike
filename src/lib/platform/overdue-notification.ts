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

export async function syncOverdueNotification(
  returnAt: Date | string | null,
  now = Date.now(),
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
