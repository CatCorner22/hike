/** [minLng, minLat, maxLng, maxLat] — the GeoJSON/bboxFromGeometry convention. */
export type BboxLngLat = [number, number, number, number];

export function parseBbox(param: string | null): BboxLngLat | null {
  if (!param) return null;
  // Number("") and Number(" ") are both 0, so a missing coordinate would otherwise
  // parse as a valid 0 and silently move the search box to the Gulf of Guinea.
  const fields = param.split(",").map((value) => value.trim());
  if (fields.length !== 4 || fields.some((value) => value === "")) return null;
  const parts = fields.map(Number);
  if (!parts.every(Number.isFinite)) return null;

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
