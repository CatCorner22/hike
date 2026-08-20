import { readFileSync } from "node:fs";

/**
 * Current route-pack version, read from source so a probe cannot silently rot
 * when ROUTE_PACK_VERSION is bumped. Pinning it produced a VersionError that
 * surfaced as a 30s "waiting for canvas" timeout rather than a clear mismatch.
 */
export const PACK_VERSION = Number(
  readFileSync(new URL("../src/lib/offline/route-pack.ts", import.meta.url), "utf8").match(
    /ROUTE_PACK_VERSION = (\d+)/,
  )[1],
);

/**
 * Browser-side source for `openEnsuringStores(name, stores)`.
 *
 * Opening with a pinned version throws VersionError once the app migrates past
 * it; opening with no version creates an EMPTY database at version 1 when the
 * profile is fresh, so a probe that writes before the app has ever run then
 * fails with "object stores was not found". Both failure modes look like a hang.
 *
 * This opens at whatever version exists, and only if a required store is absent
 * reopens at version+1 to add it. Correct on a fresh profile and after any
 * future migration, without the probe knowing the schema version.
 */
export const OPEN_ENSURING_STORES = `
function openEnsuringStores(name, stores) {
  return new Promise(function (resolve, reject) {
    var probe = indexedDB.open(name);
    probe.onerror = function () { reject(probe.error); };
    probe.onsuccess = function () {
      var db = probe.result;
      var missing = stores.filter(function (s) { return !db.objectStoreNames.contains(s.name); });
      if (missing.length === 0) { resolve(db); return; }
      var next = db.version + 1;
      db.close();
      var up = indexedDB.open(name, next);
      up.onupgradeneeded = function () {
        var d = up.result;
        missing.forEach(function (s) {
          var os = d.createObjectStore(s.name, { keyPath: s.keyPath });
          (s.indexes || []).forEach(function (ix) { os.createIndex(ix.name, ix.keyPath); });
        });
      };
      up.onsuccess = function () { resolve(up.result); };
      up.onerror = function () { reject(up.error); };
    };
  });
}
`;

/** Stores the navigate screen reads, matching src/lib/offline/route-pack.ts. */
export const NAV_PACK_STORES = [
  { name: "routePacks", keyPath: "id" },
  { name: "aliases", keyPath: "alias", indexes: [{ name: "by-canonical", keyPath: "canonicalId" }] },
  { name: "lastFix", keyPath: "id" },
];

/**
 * Builds a route-pack fixture that satisfies validationError() in
 * src/lib/offline/route-pack.ts. The pack schema is integrity-checked now, so a
 * hand-rolled literal is rejected with "Saved route distance index is invalid."
 * -- correct app behaviour, but it made the probe look like a render hang.
 */
export function packFixture(id, coordinates) {
  const R = 6371008.8;
  const rad = (d) => (d * Math.PI) / 180;
  const cumulative = [0];
  for (let i = 1; i < coordinates.length; i += 1) {
    const [lng1, lat1] = coordinates[i - 1];
    const [lng2, lat2] = coordinates[i];
    const dLat = rad(lat2 - lat1);
    const dLng = rad(lng2 - lng1);
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLng / 2) ** 2;
    cumulative.push(cumulative[i - 1] + 2 * R * Math.asin(Math.sqrt(a)));
  }
  const lngs = coordinates.map((c) => c[0]);
  const lats = coordinates.map((c) => c[1]);
  return {
    id,
    canonicalId: id,
    aliases: [id],
    name: id,
    geometry: { type: "LineString", coordinates },
    bbox: [Math.min(...lngs), Math.min(...lats), Math.max(...lngs), Math.max(...lats)],
    cumulativeDistancesMeters: cumulative,
    elevationProfile: [],
    gpx: "",
    lengthMeters: cumulative[cumulative.length - 1],
    cachedAt: new Date().toISOString(),
    version: PACK_VERSION,
  };
}
