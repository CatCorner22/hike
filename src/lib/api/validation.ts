import { z } from "zod";
import { isValidGeometry } from "@/lib/geo/navigation";

export const dateString = z
  .string()
  .refine((value) => !Number.isNaN(Date.parse(value)), "Invalid date");

export const routeGeometry = z.custom<
  GeoJSON.LineString | GeoJSON.MultiLineString
>(isValidGeometry, "Invalid route geometry");

const planFields = {
  name: z.string().trim().min(1).max(200),
  trailId: z.string().max(200).nullable(),
  plannedDate: dateString.nullable(),
  notes: z.string().max(50_000).nullable(),
  waypoints: z.unknown(),
  campgroundIds: z.array(z.string().max(200)).max(500),
  customGeometry: routeGeometry.nullable(),
};

export const createPlanSchema = z.object({
  name: planFields.name,
  trailId: planFields.trailId.optional(),
  plannedDate: planFields.plannedDate.optional(),
  notes: planFields.notes.optional(),
  waypoints: planFields.waypoints.optional(),
  campgroundIds: planFields.campgroundIds.optional(),
  customGeometry: planFields.customGeometry.optional(),
});

export const updatePlanSchema = z.object(planFields).partial();

export const updateActivitySchema = z.object({
  endedAt: dateString.nullable().optional(),
  stats: z.record(z.string(), z.number().finite()).nullable().optional(),
  notes: z.string().max(50_000).nullable().optional(),
});

export async function parseJson<T>(
  request: Request,
  schema: z.ZodType<T>,
): Promise<
  | { success: true; data: T }
  | { success: false; response: Response }
> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return {
      success: false,
      response: Response.json({ error: "Invalid JSON body" }, { status: 400 }),
    };
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return {
      success: false,
      response: Response.json(
        { error: "Invalid request", issues: parsed.error.issues },
        { status: 400 },
      ),
    };
  }
  return { success: true, data: parsed.data };
}
