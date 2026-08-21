import { describe, expect, it } from "vitest";
import {
  backupParseError,
  PACK_BACKUP_DISCLAIMER,
  parseRoutePackBackup,
  serializeRoutePackBackup,
} from "./pack-backup";
import { buildRoutePack, ROUTE_PACK_VERSION } from "./route-pack";

const geometry: GeoJSON.LineString = {
  type: "LineString",
  coordinates: [
    [-119.5383, 37.7749],
    [-119.5379, 37.7751],
  ],
};

describe("route pack backup", () => {
  it("round-trips a ready pack and keeps the device-only disclaimer", () => {
    const pack = buildRoutePack({ id: "plan-backup", name: "Backup route", geometry });
    const text = serializeRoutePackBackup(pack);
    expect(text).toContain(PACK_BACKUP_DISCLAIMER);
    expect(text).toContain("klandagi-route-pack");
    const parsed = parseRoutePackBackup(text);
    expect("error" in parsed).toBe(false);
    if ("pack" in parsed) {
      expect(parsed.pack.id).toBe(pack.id);
      expect(parsed.pack.geometry).toEqual(pack.geometry);
      expect(parsed.pack.corridor?.routeId).toBe(pack.id);
    }
  });

  it("rejects a raw pack, a forged wrapper, or an older payload version", () => {
    const pack = buildRoutePack({ id: "plan-backup", name: "Backup route", geometry });
    expect(backupParseError(parseRoutePackBackup(JSON.stringify(pack)))).toMatch(/not a Klandagi route-pack backup/);
    const honest = JSON.parse(serializeRoutePackBackup(pack)) as Record<string, unknown>;
    expect(backupParseError(parseRoutePackBackup(JSON.stringify({ ...honest, kind: "alltrails-pack" })))).toMatch(/not a Klandagi/);
    expect(backupParseError(parseRoutePackBackup(JSON.stringify({ ...honest, disclaimer: "cloud synced" })))).toMatch(/disclaimer/);
    expect(backupParseError(parseRoutePackBackup(JSON.stringify({
      ...honest,
      pack: { ...pack, version: ROUTE_PACK_VERSION - 1 },
    })))).toMatch(/older pack format/);
  });

  it("rejects a poisoned corridor inside an otherwise wrapped backup", () => {
    const pack = buildRoutePack({ id: "plan-backup", name: "Backup route", geometry });
    const honest = JSON.parse(serializeRoutePackBackup(pack)) as { pack: typeof pack };
    honest.pack = {
      ...honest.pack,
      corridor: { ...honest.pack.corridor!, routeId: "someone-else" },
    };
    expect(backupParseError(parseRoutePackBackup(JSON.stringify(honest)))).toMatch(/terrain corridor/);
  });
});
