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
