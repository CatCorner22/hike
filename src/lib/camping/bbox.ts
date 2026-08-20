export type Bbox = [
  west: number,
  south: number,
  east: number,
  north: number,
];

export function parseBbox(value: string | null): Bbox | null {
  if (!value) return null;
  const parts = value.split(",");
  if (parts.some((part) => part.trim() === "")) return null;
  const coordinates = parts.map(Number);
  if (coordinates.length !== 4 || !coordinates.every(Number.isFinite)) return null;
  const [west, south, east, north] = coordinates;
  if (
    west < -180 ||
    east > 180 ||
    south < -90 ||
    north > 90 ||
    west >= east ||
    south >= north
  ) {
    return null;
  }
  return [west, south, east, north];
}
