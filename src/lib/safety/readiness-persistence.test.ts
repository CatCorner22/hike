import { describe, expect, it, vi } from "vitest";
import {
  persistAndVerifyReadiness,
  type ReadinessPersistenceStore,
} from "./readiness-persistence";
import type { CheckinSettings } from "./checkin";
import type { IceProfile, OverdueAlarm, ResolvedLocalTime } from "./profile";

const profile: IceProfile = {
  name: "Rae",
  iceName: "Sam",
  icePhone: "+1 865 555 0100",
  medical: "",
  partySize: 2,
};
const oldProfile: IceProfile = {
  name: "Old hiker",
  iceName: "Old contact",
  icePhone: "+1 865 555 0199",
  medical: "old record",
  partySize: 1,
};
const deadline: ResolvedLocalTime = {
  instant: new Date("2026-08-23T00:00:00.000Z"),
  resolvedLocal: "2026-08-22T20:00",
  timeZone: "America/New_York",
  utcOffset: "GMT-4",
};
const storedDeadline: OverdueAlarm = {
  returnAt: deadline.instant.toISOString(),
  resolvedLocal: deadline.resolvedLocal,
  timeZone: deadline.timeZone,
  utcOffset: deadline.utcOffset,
};
const now = new Date("2026-08-22T12:00:00.000Z");

function successfulStore(): ReadinessPersistenceStore {
  let savedProfile = oldProfile;
  let savedDeadline: OverdueAlarm | null = null;
  let savedCheckin: CheckinSettings = { enabled: false, intervalMin: 60 };
  return {
    saveProfile: vi.fn(async (next) => {
      savedProfile = next;
      return true;
    }),
    getProfile: vi.fn(async () => savedProfile),
    saveReturnTime: vi.fn(async (next) => {
      savedDeadline = next ? storedDeadline : null;
      return true;
    }),
    getReturnTime: vi.fn(async () => savedDeadline),
    saveCheckin: vi.fn(async (next) => {
      savedCheckin = next;
      return true;
    }),
    getCheckin: vi.fn(async () => savedCheckin),
  };
}

const input = {
  profile,
  returnTime: deadline,
  checkin: { enabled: true, intervalMin: 60 },
};

describe("readiness persistence boundary", () => {
  it("stops on a failed first write and never unlocks on in-memory form state", async () => {
    const store = successfulStore();
    store.saveProfile = vi.fn(async () => false);

    await expect(persistAndVerifyReadiness(input, store, now)).resolves.toMatchObject({
      ok: false,
      stage: "profile",
      message: expect.stringMatching(/could not be written/i),
    });
    expect(store.getProfile).not.toHaveBeenCalled();
    expect(store.saveReturnTime).not.toHaveBeenCalled();
    expect(store.saveCheckin).not.toHaveBeenCalled();
  });

  it("rejects a failed replacement whose read-back is an older valid record", async () => {
    const store = successfulStore();
    store.saveProfile = vi.fn(async () => true);
    store.getProfile = vi.fn(async () => oldProfile);

    await expect(persistAndVerifyReadiness(input, store, now)).resolves.toMatchObject({
      ok: false,
      stage: "profile",
      message: expect.stringMatching(/did not match/i),
    });
    expect(store.saveReturnTime).not.toHaveBeenCalled();
  });

  it("accepts only a successful exact read-back of ICE, deadline, and check-in state", async () => {
    const store = successfulStore();

    await expect(persistAndVerifyReadiness(input, store, now)).resolves.toEqual({ ok: true });
    expect(store.saveCheckin).toHaveBeenCalledWith({
      enabled: true,
      intervalMin: 60,
      armedAt: now.toISOString(),
    });
    expect(store.getProfile).toHaveBeenCalledOnce();
    expect(store.getReturnTime).toHaveBeenCalledOnce();
    expect(store.getCheckin).toHaveBeenCalledOnce();
  });
});
