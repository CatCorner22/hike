export const ACTIVITY_DISPLAY_POINT_BUDGET = 2_000;

/**
 * Preserve track endpoints while bounding the geometry sent to a display client.
 * Full-fidelity points remain available to GPX export and the paginated points API.
 */
export function downsampleActivityPoints<T>(points: T[]): {
  points: T[];
  pointCount: number;
  downsampled: boolean;
} {
  if (points.length <= ACTIVITY_DISPLAY_POINT_BUDGET) {
    return { points, pointCount: points.length, downsampled: false };
  }
  const stride = Math.ceil(points.length / ACTIVITY_DISPLAY_POINT_BUDGET);
  const reduced: T[] = [];
  for (let index = 0; index < points.length; index += stride) reduced.push(points[index]);
  const last = points[points.length - 1];
  if (reduced[reduced.length - 1] !== last) reduced.push(last);
  return { points: reduced, pointCount: points.length, downsampled: true };
}
