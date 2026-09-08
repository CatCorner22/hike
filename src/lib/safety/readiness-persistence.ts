import {
  getIceProfile,
  getOverdueAlarm,
  saveIceProfile,
  setOverdueAlarm,
  type IceProfile,
  type OverdueAlarm,
  type ResolvedLocalTime,
} from "@/lib/safety/profile";
import {
  getCheckinSettings,
  saveCheckinSettings,
  type CheckinSettings,
} from "@/lib/safety/checkin";

export interface ReadinessPersistenceInput {
  profile: IceProfile;
  returnTime: ResolvedLocalTime | null;
  checkin: Pick<CheckinSettings, "enabled" | "intervalMin">;
}

export interface ReadinessPersistenceStore {
  saveProfile(profile: IceProfile): Promise<boolean>;
  getProfile(): Promise<IceProfile>;
  saveReturnTime(returnTime: ResolvedLocalTime | null): Promise<boolean>;
  getReturnTime(): Promise<OverdueAlarm | null>;
  saveCheckin(settings: CheckinSettings): Promise<boolean>;
  getCheckin(): Promise<CheckinSettings>;
}

export type ReadinessPersistenceResult =
  | { ok: true }
  | { ok: false; stage: "profile" | "return-time" | "check-in"; message: string };

const DEFAULT_STORE: ReadinessPersistenceStore = {
  saveProfile: saveIceProfile,
  getProfile: getIceProfile,
  saveReturnTime: setOverdueAlarm,
  getReturnTime: getOverdueAlarm,
  saveCheckin: saveCheckinSettings,
  getCheckin: getCheckinSettings,
};

const PROFILE_FIELDS = [
  "name",
  "iceName",
  "icePhone",
  "medical",
  "partySize",
  "bloodType",
  "challenge",
  "password",
  "responderAgency",
  "responderPhone",
  "partySizeConfirmed",
] as const satisfies ReadonlyArray<keyof IceProfile>;

function sameProfile(expected: IceProfile, actual: IceProfile): boolean {
  return PROFILE_FIELDS.every((key) => (expected[key] ?? "") === (actual[key] ?? ""));
}

function storedReturnTime(returnTime: ResolvedLocalTime | null): OverdueAlarm | null {
  return returnTime
    ? {
        returnAt: returnTime.instant.toISOString(),
        resolvedLocal: returnTime.resolvedLocal,
        timeZone: returnTime.timeZone,
        utcOffset: returnTime.utcOffset,
      }
    : null;
}

function sameReturnTime(expected: OverdueAlarm | null, actual: OverdueAlarm | null): boolean {
  if (expected == null || actual == null) return expected === actual;
  return (
    expected.returnAt === actual.returnAt &&
    expected.resolvedLocal === actual.resolvedLocal &&
    expected.timeZone === actual.timeZone &&
    expected.utcOffset === actual.utcOffset
  );
}

function sameCheckin(expected: CheckinSettings, actual: CheckinSettings): boolean {
  return (
    expected.enabled === actual.enabled &&
    expected.intervalMin === actual.intervalMin &&
    (expected.armedAt ?? null) === (actual.armedAt ?? null)
  );
}

function failure(
  stage: "profile" | "return-time" | "check-in",
  detail: "write" | "read-back",
): ReadinessPersistenceResult {
  const label = stage === "profile" ? "ICE details" : stage === "return-time" ? "return time" : "check-in settings";
  const reason = detail === "write" ? "could not be written" : "did not match after it was read back";
  return {
    ok: false,
    stage,
    message: `${label} ${reason}. Storage may be unavailable or full. Retry before leaving; some earlier fields may already have saved.`,
  };
}

/**
 * Writes and then reads back every readiness record before navigation unlocks.
 * A boolean from IndexedDB is not enough: a failed replacement can leave an old,
 * valid-looking ICE card or deadline behind. Equality with this exact attempt is
 * the boundary between "shown in the form" and "saved on this device".
 */
export async function persistAndVerifyReadiness(
  input: ReadinessPersistenceInput,
  store: ReadinessPersistenceStore = DEFAULT_STORE,
  now = new Date(),
): Promise<ReadinessPersistenceResult> {
  let stage: "profile" | "return-time" | "check-in" = "profile";
  try {
    const checkin: CheckinSettings = input.checkin.enabled
      ? {
          enabled: true,
          intervalMin: input.checkin.intervalMin,
          armedAt: now.toISOString(),
        }
      : { enabled: false, intervalMin: input.checkin.intervalMin };

    if (!(await store.saveProfile(input.profile))) return failure("profile", "write");
    if (!sameProfile(input.profile, await store.getProfile())) return failure("profile", "read-back");

    stage = "return-time";
    if (!(await store.saveReturnTime(input.returnTime))) return failure("return-time", "write");
    if (!sameReturnTime(storedReturnTime(input.returnTime), await store.getReturnTime())) {
      return failure("return-time", "read-back");
    }

    stage = "check-in";
    if (!(await store.saveCheckin(checkin))) return failure("check-in", "write");
    if (!sameCheckin(checkin, await store.getCheckin())) return failure("check-in", "read-back");

    return { ok: true };
  } catch {
    const label = stage === "profile" ? "ICE details" : stage === "return-time" ? "return time" : "check-in settings";
    return {
      ok: false,
      stage,
      message: `${label} could not be verified after saving. Storage may be unavailable or full. Retry before leaving; some earlier fields may already have saved.`,
    };
  }
}
