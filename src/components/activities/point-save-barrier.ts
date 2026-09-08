/**
 * Tracks GPS writes that have started but have not yet reached durable local storage or
 * the server. `drain` loops because a callback already queued by the browser may register
 * one more write while a Stop action is beginning.
 */
export class PointSaveBarrier {
  private readonly pending = new Set<Promise<void>>();

  track<T>(operation: Promise<T>): Promise<T> {
    const settled = operation.then(() => undefined, () => undefined);
    this.pending.add(settled);
    void settled.then(() => this.pending.delete(settled));
    return operation;
  }

  async drain(): Promise<void> {
    while (this.pending.size > 0) {
      await Promise.all([...this.pending]);
    }
  }

  get size(): number {
    return this.pending.size;
  }
}
