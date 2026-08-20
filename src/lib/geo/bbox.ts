/** [minLng, minLat, maxLng, maxLat] — the GeoJSON/bboxFromGeometry convention. */
export type BboxLngLat = [number, number, number, number];

export function parseBbox(param: string | null): BboxLngLat | null {
  if (!param) return null;
  const parts = param.split(",").map((value) => Number(value.trim()));
  if (parts.length !== 4 || !parts.every(Number.isFinite)) return null;

  const [minLng, minLat, maxLng, maxLat] = parts;
  if (
    minLng < -180 || minLng > 180 || maxLng < -180 || maxLng > 180 ||
    minLat < -90 || minLat > 90 || maxLat < -90 || maxLat > 90 ||
    minLng > maxLng || minLat > maxLat
  ) {
    return null;
  }
  return [minLng, minLat, maxLng, maxLat];
}

/** Converts [minLng, minLat, maxLng, maxLat] to Overpass's [south, west, north, east]. */
export function toSouthWestNorthEast([minLng, minLat, maxLng, maxLat]: BboxLngLat): [number, number, number, number] {
  return [minLat, minLng, maxLat, maxLng];
}
