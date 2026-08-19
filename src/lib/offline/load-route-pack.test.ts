import { describe, expect, it } from "vitest";
import { withNetworkTimeout } from "./load-route-pack";

describe("withNetworkTimeout", () => {
  it("aborts the in-flight work when time runs out", async () => {
    let aborted = false;
    await expect(
      withNetworkTimeout((signal) => {
        return new Promise<string>((_, reject) => {
          signal.addEventListener("abort", () => {
            aborted = true;
            reject(new DOMException("Aborted", "AbortError"));
          });
        });
      }, 20),
    ).rejects.toThrow("Network timeout");
    expect(aborted).toBe(true);
  });

  it("returns the value when the factory finishes in time", async () => {
    await expect(withNetworkTimeout(async () => "ok", 200)).resolves.toBe("ok");
  });
});
