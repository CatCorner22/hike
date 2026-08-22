export interface OsmTrailRef {
  osmType: "relation" | "way" | "node";
  osmId: string;
}

export function parseOsmTrailId(id: string): OsmTrailRef | null {
  const match = id.match(/^osm-(relation|way|node)-(\d+)$/);
  if (!match) return null;
  return {
    osmType: match[1] as OsmTrailRef["osmType"],
    osmId: match[2],
  };
}

export function osmTrailId(osmType: string, osmId: string): string {
  return `osm-${osmType}-${osmId}`;
}

/** UUID from the trails table, or the stable Explore href `osm-relation-123`. */
export function isStoredTrailRef(value: string): boolean {
  if (value.length === 0 || value.length > 128) return false;
  if (parseOsmTrailId(value)) return true;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export function trailPageHref(trailId: string, osmType?: string | null, osmId?: string | null): string {
  if (osmType && osmId) return `/trails/${osmTrailId(osmType, osmId)}`;
  return `/trails/${trailId}`;
}

export function parseNavigateTarget(navId: string): {
  kind: "trail" | "plan";
  id: string;
} | null {
  if (navId.startsWith("trail-")) {
    return { kind: "trail", id: navId.slice("trail-".length) };
  }
  if (navId.startsWith("plan-")) {
    return { kind: "plan", id: navId.slice("plan-".length) };
  }
  return null;
}
