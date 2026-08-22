import { describe, expect, it } from "vitest";
import { PointSaveBarrier } from "./point-save-barrier";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

describe("PointSaveBarrier", () => {
  it("does not let finalization pass a delayed final GPS save", async () => {
    const barrier = new PointSaveBarrier();
    const finalPoint = deferred<void>();
    const order: string[] = [];

    void barrier.track(finalPoint.promise.then(() => {
      order.push("final-point-durable");
    }));
    const stop = (async () => {
      await barrier.drain();
      order.push("activity-finalized");
    })();

    await Promise.resolve();
    expect(barrier.size).toBe(1);
    expect(order).toEqual([]);

    finalPoint.resolve();
    await stop;
    expect(order).toEqual(["final-point-durable", "activity-finalized"]);
    expect(barrier.size).toBe(0);
  });

  it("drains a rejected save without creating an unhandled barrier failure", async () => {
    const barrier = new PointSaveBarrier();
    const failed = deferred<void>();
    const operation = barrier.track(failed.promise);
    void operation.catch(() => undefined);

    failed.reject(new Error("storage full"));
    await expect(barrier.drain()).resolves.toBeUndefined();
    expect(barrier.size).toBe(0);
  });
});
