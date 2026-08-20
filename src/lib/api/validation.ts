import { NextResponse } from "next/server";
import { z, type ZodType } from "zod";

const finiteNumber = z.number().refine(Number.isFinite, "Must be a finite number");
export const MAX_JSON_BODY_BYTES = 1024 * 1024;

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

const lineCoordinatesSchema = z.array(positionSchema).min(2).max(10_000);

export const geoJsonLineStringSchema = z.object({
  type: z.literal("LineString"),
  coordinates: lineCoordinatesSchema,
});

export const geoJsonMultiLineStringSchema = z.object({
  type: z.literal("MultiLineString"),
  coordinates: z.array(lineCoordinatesSchema).min(1).max(100),
});

export const geoJsonLineOrMultiLineStringSchema = z.union([
  geoJsonLineStringSchema,
  geoJsonMultiLineStringSchema,
]);

const waypointSchema = z.object({
  lat: finiteNumber.min(-90).max(90),
  lng: finiteNumber.min(-180).max(180),
  id: z.string().trim().min(1).max(128).optional(),
  name: z.string().trim().min(1).max(200).optional(),
  kind: z.string().trim().min(1).max(64).optional(),
  notes: z.string().max(2_000).optional(),
}).strict();

export const waypointsSchema = z.array(waypointSchema).max(1_000).superRefine((value, ctx) => {
  // Defend JSONB/storage independently of the overall request cap. The shape
  // has fixed depth; this catches pathological long strings and future cap
  // changes without accepting a large arbitrary object.
  if (new TextEncoder().encode(JSON.stringify(value)).byteLength > 256 * 1024) {
    ctx.addIssue({ code: "custom", message: "Waypoints must not exceed 256 KiB serialized" });
  }
});

function tooLargeResponse(maxBytes: number) {
  return NextResponse.json(
    { error: "Request body is too large", maxBytes },
    { status: 413, headers: { "Cache-Control": "no-store" } },
  );
}

async function readJsonText(request: Request, maxBytes: number): Promise<string | null> {
  const contentLength = request.headers.get("content-length");
  if (contentLength) {
    const declared = Number(contentLength);
    if (!Number.isSafeInteger(declared) || declared < 0 || declared > maxBytes) return null;
  }
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

function containsUnsafeIntegerLiteral(text: string): boolean {
  let inString = false;
  let escaped = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === "\"") inString = false;
      continue;
    }
    if (char === "\"") { inString = true; continue; }
    if (char !== "-" && (char < "0" || char > "9")) continue;
    const match = text.slice(index).match(/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/);
    if (!match) continue;
    const token = match[0];
    index += token.length - 1;
    if (!/[.eE]/.test(token)) {
      try {
        const integer = BigInt(token);
        if (integer > BigInt(Number.MAX_SAFE_INTEGER) || integer < BigInt(Number.MIN_SAFE_INTEGER)) return true;
      } catch {
        // JSON.parse below reports malformed number syntax.
      }
    }
  }
  return false;
}

export async function parseJsonBody<T>(
  request: Request,
  schema: ZodType<T>,
  options: { maxBytes?: number } = {},
): Promise<{ ok: true; data: T } | { ok: false; response: NextResponse }> {
  const maxBytes = options.maxBytes ?? MAX_JSON_BODY_BYTES;
  const text = await readJsonText(request, maxBytes);
  if (text === null) return { ok: false, response: tooLargeResponse(maxBytes) };
  if (containsUnsafeIntegerLiteral(text)) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Invalid JSON body", issues: [{ path: [], message: "Integer values must be safe JavaScript integers" }] },
        { status: 400 },
      ),
    };
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
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
