import { describe, expect, it } from "vitest";
import { formatOfflineRouteStorageError } from "./offline-readiness";

describe("formatOfflineRouteStorageError", () => {
  it("replaces an incompatible IndexedDB version error with a recovery action", () => {
    const result = formatOfflineRouteStorageError(
      new DOMException("The requested version (4) is less than the existing version (99).", "VersionError"),
    );

    expect(result.message).toBe(
      "This device has a newer, incompatible, or damaged saved-route database. Reconnect and re-download this route before relying on this device.",
    );
    expect(result.diagnostic).toContain("requested version");
    expect(result.message).not.toContain("requested version");
  });

  it("maps raw transaction jargon to the same recovery action", () => {
    const result = formatOfflineRouteStorageError(
      new Error("Failed to execute 'transaction' on 'IDBDatabase': Object store missing."),
    );

    expect(result.message).toContain("Reconnect and re-download");
    expect(result.message).not.toContain("IDBDatabase");
  });
});
