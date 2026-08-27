import { openDB, type DBSchema, type IDBPDatabase, type OpenDBCallbacks } from "idb";

/**
 * Opening IndexedDB has two failure modes that must never become permanent on a
 * device that will be offline in the field:
 *
 * 1. A rejected `openDB` — storage denied in a private window, quota exhausted,
 *    a corrupt store. Caching that rejection for the session means one transient
 *    failure disables the store (route packs, breadcrumb, pending points) until
 *    the page is reloaded, which offline may never happen.
 * 2. A blocked upgrade — another tab holding an older schema version open. The
 *    open promise then never settles, and every caller awaiting it hangs
 *    forever with no message.
 *
 * `src/lib/safety/profile.ts` fixed both for the safety store (see its tests);
 * this helper is the same discipline for the stores whose callers expect a
 * rejection rather than a null database. Failures propagate to the caller
 * exactly as before, but are never cached: the next call genuinely retries. A
 * blocked upgrade rejects with `IdbOpenBlockedError` after a bounded wait, and
 * the pending attempt is kept so a retry re-awaits it instead of stacking a
 * second connection on top.
 */
export class IdbOpenBlockedError extends Error {
  constructor(databaseName: string) {
    super(
      "Offline storage is busy — another Klandagi tab may be updating it. Close other tabs for this site and retry.",
    );
    this.name = "IdbOpenBlockedError";
    this.databaseName = databaseName;
  }

  readonly databaseName: string;
}

const DEFAULT_BLOCKED_TIMEOUT_MS = 7_000;

export interface IdbOpener<S extends DBSchema> {
  /** Null when this browser has no IndexedDB at all; otherwise a fresh-or-cached open. */
  getDb: () => Promise<IDBPDatabase<S>> | null;
  /** Close and forget the cached connection so the next call re-opens. */
  reset: () => Promise<void>;
}

export function createIdbOpener<S extends DBSchema>(
  name: string,
  version: number,
  callbacks: Pick<OpenDBCallbacks<S>, "upgrade">,
  options: { blockedTimeoutMs?: number } = {},
): IdbOpener<S> {
  const blockedTimeoutMs = options.blockedTimeoutMs ?? DEFAULT_BLOCKED_TIMEOUT_MS;
  let openAttempt: Promise<IDBPDatabase<S>> | null = null;
  let liveDb: IDBPDatabase<S> | null = null;

  const forget = () => {
    openAttempt = null;
    liveDb = null;
  };

  const open = async (): Promise<IDBPDatabase<S>> => {
    if (!openAttempt) {
      const attempt = openDB<S>(name, version, {
        upgrade: callbacks.upgrade,
        // This tab is the one holding an older version open somewhere else.
        // Let go, or the other tab is the one that hangs.
        blocking() {
          const live = liveDb;
          const pending = openAttempt;
          forget();
          if (live) {
            live.close();
            return;
          }
          // `blocking` can land in the microtasks between openDB resolving and
          // the assignment below, so close whatever the open produces instead.
          void pending?.then((db) => db.close(), () => {});
        },
        terminated() {
          forget();
        },
      });
      openAttempt = attempt;
      // Attach a handler now so the rejection can never surface as an unhandled
      // one, and drop the attempt so a later call opens a fresh connection.
      attempt.catch(() => {
        if (openAttempt === attempt) forget();
      });
    }

    const attempt = openAttempt;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const db = await Promise.race([
        attempt,
        new Promise<null>((resolve) => {
          timer = setTimeout(() => resolve(null), blockedTimeoutMs);
        }),
      ]);
      if (!db) {
        // Still blocked. Keep `openAttempt` so a retry re-awaits the same
        // pending open rather than stacking a second connection on top of it.
        throw new IdbOpenBlockedError(name);
      }
      liveDb = db;
      return db;
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  };

  return {
    getDb: () => (typeof indexedDB === "undefined" ? null : open()),
    reset: async () => {
      const current = openAttempt;
      forget();
      if (current) {
        try {
          (await current).close();
        } catch {
          /* the failed open has nothing to close */
        }
      }
    },
  };
}
