import { NextResponse } from "next/server";
import { z, type ZodType } from "zod";

const finiteNumber = z.number().refine(Number.isFinite, "Must be a finite number");

export const latLngPointSchema = z.object({
  lat: finiteNumber.min(-90).max(90),
  lng: finiteNumber.min(-180).max(180),
});

export const isoDatetimeSchema = z.string().refine(
  (value) => {
    const isIsoDatetime = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(value);
    const timestamp = Date.parse(value);
    return isIsoDatetime && Number.isFinite(timestamp) && !Number.isNaN(timestamp);
  },
  "Must be a valid ISO date-time string",
);

const positionSchema = z
  .array(finiteNumber)
  .min(2)
  .max(3)
  .superRefine((position, ctx) => {
    if (position[0] < -180 || position[0] > 180) {
      ctx.addIssue({ code: "custom", message: "Longitude must be between -180 and 180", path: [0] });
    }
    if (position[1] < -90 || position[1] > 90) {
      ctx.addIssue({ code: "custom", message: "Latitude must be between -90 and 90", path: [1] });
    }
  });

const lineCoordinatesSchema = z.array(positionSchema).min(2);

export const geoJsonLineStringSchema = z.object({
  type: z.literal("LineString"),
  coordinates: lineCoordinatesSchema,
});

export const geoJsonMultiLineStringSchema = z.object({
  type: z.literal("MultiLineString"),
  coordinates: z.array(lineCoordinatesSchema).min(1),
});

export const geoJsonLineOrMultiLineStringSchema = z.union([
  geoJsonLineStringSchema,
  geoJsonMultiLineStringSchema,
]);

export async function parseJsonBody<T>(
  request: Request,
  schema: ZodType<T>,
): Promise<{ ok: true; data: T } | { ok: false; response: NextResponse }> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Invalid JSON body", issues: [{ path: [], message: "Request body must be valid JSON" }] },
        { status: 400 },
      ),
    };
  }

  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      response: NextResponse.json(
        {
          error: "Invalid request body",
          issues: parsed.error.issues.map((issue) => ({
            path: issue.path,
            message: issue.message,
          })),
        },
        { status: 400 },
      ),
    };
  }

  return { ok: true, data: parsed.data };
}
