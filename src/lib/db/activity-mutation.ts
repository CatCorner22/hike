const activityMutationTails = new Map<string, Promise<void>>();

/**
 * The JSON fallback is a single file, so two requests can otherwise both observe an
 * open activity (or an absent point) before either file mutation runs. Serializing an
 * activity's API mutations makes its answer match the database path: a completed hike
 * cannot acknowledge a later fix that it will not show to the hiker.
 */
export async function withActivityMutation<T>(
  activityId: string,
  operation: () => Promise<T>,
): Promise<T> {
  const previous = activityMutationTails.get(activityId) ?? Promise.resolve();
  let releaseCurrent!: () => void;
  const current = new Promise<void>((resolve) => {
    releaseCurrent = resolve;
  });
  const tail = previous.catch(() => undefined).then(() => current);
  activityMutationTails.set(activityId, tail);

  await previous.catch(() => undefined);
  try {
    return await operation();
  } finally {
    releaseCurrent();
    if (activityMutationTails.get(activityId) === tail) {
      activityMutationTails.delete(activityId);
    }
  }
}
