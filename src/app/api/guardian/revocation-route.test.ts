import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  revokeGuardianShare: vi.fn(),
}));

vi.mock("@/lib/auth/owner", () => ({
  requireOwner: vi.fn(async () => ({ ok: true, ownerId: "owner-test" })),
}));

vi.mock("@/lib/guardian/server", () => ({
  GuardianStorageUnavailableError: class GuardianStorageUnavailableError extends Error {},
  getGuardianShareForOwner: vi.fn(),
  updateGuardianShareStatus: vi.fn(),
  revokeGuardianShare: mocks.revokeGuardianShare,
}));

import { PATCH } from "./[id]/route";

function revokeRequest() {
  return new Request("http://localhost/api/guardian/share-test", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "revoke" }),
  });
}

const params = { params: Promise.resolve({ id: "share-test" }) };

describe("Guardian revocation acknowledgement", () => {
  beforeEach(() => {
    mocks.revokeGuardianShare.mockReset();
  });

  it("does not acknowledge a revocation unless storage returned a revocation time", async () => {
    mocks.revokeGuardianShare.mockResolvedValue({ id: "share-test", revokedAt: null });

    const response = await PATCH(revokeRequest(), params);

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: "Revocation was not confirmed; the link may still work",
    });
  });

  it("returns the exact durable revocation time", async () => {
    const revokedAt = new Date("2026-08-22T14:00:00.000Z");
    mocks.revokeGuardianShare.mockResolvedValue({ id: "share-test", revokedAt });

    const response = await PATCH(revokeRequest(), params);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      acknowledged: true,
      revokedAt: revokedAt.toISOString(),
    });
  });
});
