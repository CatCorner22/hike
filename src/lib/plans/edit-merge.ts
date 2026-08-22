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
