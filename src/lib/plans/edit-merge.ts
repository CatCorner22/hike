/**
 * Apply a server acknowledgement without overwriting local fields that were not
 * part of that request, or edits made while the request was in flight.
 */
export function mergeConfirmedEdit<T extends object, K extends keyof T>(input: {
  confirmed: T;
  requestBase: T;
  latestDraft: T;
  submitted: Partial<T>;
  editableKeys: readonly K[];
}): T {
  const next = { ...input.confirmed };
  for (const key of input.editableKeys) {
    if (
      !Object.prototype.hasOwnProperty.call(input.submitted, key)
      || input.latestDraft[key] !== input.requestBase[key]
    ) {
      next[key] = input.latestDraft[key];
    }
  }
  return next;
}

/**
 * Keep every field whose most recent save attempt failed so a retry cannot
 * silently discard an earlier failure. Undefined values are omitted because
 * JSON requests do not submit them to the server.
 */
export function accumulatePendingEdit<T extends object>(
  pending: Partial<T> | null,
  failed: Partial<T>,
): Partial<T> | null {
  const next: Partial<T> = { ...(pending ?? {}) };
  for (const key of Object.keys(failed) as Array<keyof T>) {
    if (failed[key] !== undefined) next[key] = failed[key];
  }
  return Object.keys(next).length > 0 ? next : null;
}

/**
 * Remove only fields submitted by this successful request. Other failed
 * fields remain available for retry instead of being cleared by an unrelated
 * acknowledgement.
 */
export function acknowledgePendingEdit<T extends object>(
  pending: Partial<T> | null,
  acknowledged: Partial<T>,
): Partial<T> | null {
  if (!pending) return null;
  const next: Partial<T> = { ...pending };
  for (const key of Object.keys(acknowledged) as Array<keyof T>) {
    if (acknowledged[key] !== undefined) delete next[key];
  }
  return Object.keys(next).length > 0 ? next : null;
}

/**
 * Retry the failed fields with their current draft values, not the values that
 * happened to fail earlier. This prevents a Retry click triggered by an input
 * blur from overwriting the user's newer edit with stale retry data.
 */
export function currentPendingEdit<T extends object>(
  pending: Partial<T> | null,
  currentDraft: T | null,
): Partial<T> | null {
  if (!pending || !currentDraft) return null;
  const next: Partial<T> = {};
  for (const key of Object.keys(pending) as Array<keyof T>) {
    next[key] = currentDraft[key];
  }
  return Object.keys(next).length > 0 ? next : null;
}
