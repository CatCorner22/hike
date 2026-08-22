import type { SafetyWaypoint } from "@/lib/safety/profile";

export const MAX_PHOTO_INPUT_BYTES = 15 * 1024 * 1024;
export const MAX_PHOTO_OUTPUT_BYTES = 2 * 1024 * 1024;
export const MAX_PHOTO_EDGE_PX = 1_600;

export type EverydayWaypointKind = "note" | "water" | "junction" | "camp";

export const EVERYDAY_WAYPOINT_KINDS: Array<{
  value: EverydayWaypointKind;
  label: string;
}> = [
  { value: "note", label: "Place" },
  { value: "water", label: "Water" },
  { value: "junction", label: "Trail split" },
  { value: "camp", label: "Campsite" },
];

export function waypointKindLabel(kind: SafetyWaypoint["kind"]): string {
  return (
    {
      note: "Marked place",
      water: "Water",
      junction: "Trail split",
      camp: "Campsite",
      lkp: "Last known point",
      rp: "Rally point",
      orp: "Observation rally point",
      ap: "Approach point",
      cf: "Catch feature",
      hr: "Handrail",
    } satisfies Record<SafetyWaypoint["kind"], string>
  )[kind];
}

export function fitPhotoSize(
  width: number,
  height: number,
  maxEdge = MAX_PHOTO_EDGE_PX,
): { width: number; height: number } {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new Error("This image has invalid dimensions.");
  }
  const scale = Math.min(1, maxEdge / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

interface DecodedImage {
  source: CanvasImageSource;
  width: number;
  height: number;
  close: () => void;
}

async function decodeImage(file: Blob): Promise<DecodedImage> {
  if (typeof createImageBitmap === "function") {
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    return {
      source: bitmap,
      width: bitmap.width,
      height: bitmap.height,
      close: () => bitmap.close(),
    };
  }

  if (typeof document === "undefined") throw new Error("This browser cannot decode photos here.");
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.decoding = "async";
    image.src = url;
    await image.decode();
    return {
      source: image,
      width: image.naturalWidth,
      height: image.naturalHeight,
      close: () => URL.revokeObjectURL(url),
    };
  } catch (error) {
    URL.revokeObjectURL(url);
    throw error;
  }
}

function canvasJpeg(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob || blob.type !== "image/jpeg") {
          reject(new Error("This browser could not make a private JPEG copy."));
          return;
        }
        resolve(blob);
      },
      "image/jpeg",
      quality,
    );
  });
}

/**
 * Decodes pixels and creates a new JPEG container. GPS, camera serial numbers,
 * timestamps, thumbnails, and other source-file metadata are not copied.
 */
export async function prepareFieldPhoto(file: Blob): Promise<{
  blob: Blob;
  width: number;
  height: number;
}> {
  if (!file.type.startsWith("image/")) throw new Error("Choose an image file.");
  if (file.size < 1) throw new Error("That photo is empty.");
  if (file.size > MAX_PHOTO_INPUT_BYTES) throw new Error("That photo is over the 15 MB input limit.");
  if (typeof document === "undefined") throw new Error("Photo processing is unavailable here.");

  const decoded = await decodeImage(file);
  try {
    let maxEdge = MAX_PHOTO_EDGE_PX;
    for (let sizeAttempt = 0; sizeAttempt < 3; sizeAttempt += 1) {
      const fitted = fitPhotoSize(decoded.width, decoded.height, maxEdge);
      const canvas = document.createElement("canvas");
      canvas.width = fitted.width;
      canvas.height = fitted.height;
      const context = canvas.getContext("2d", { alpha: false });
      if (!context) throw new Error("This browser cannot prepare photos offline.");
      context.fillStyle = "#fff";
      context.fillRect(0, 0, fitted.width, fitted.height);
      context.drawImage(decoded.source, 0, 0, fitted.width, fitted.height);

      for (const quality of [0.78, 0.68, 0.58]) {
        const blob = await canvasJpeg(canvas, quality);
        if (blob.size <= MAX_PHOTO_OUTPUT_BYTES) {
          return { blob, width: fitted.width, height: fitted.height };
        }
      }
      maxEdge = Math.round(maxEdge * 0.75);
    }
    throw new Error("The private photo copy is still over 2 MB. Try a simpler or smaller photo.");
  } finally {
    decoded.close();
  }
}

export function waypointsGeoJson(trailName: string, waypoints: SafetyWaypoint[]): string {
  return JSON.stringify(
    {
      type: "FeatureCollection",
      name: `${trailName} saved places`,
      features: waypoints.map((waypoint) => ({
        type: "Feature",
        id: waypoint.id,
        geometry: { type: "Point", coordinates: [waypoint.lng, waypoint.lat] },
        properties: {
          category: waypointKindLabel(waypoint.kind),
          note: waypoint.note ?? null,
          recordedAt: waypoint.recordedAt,
          positionSource: waypoint.positionSource ?? "unknown",
          positionRecordedAt: waypoint.positionRecordedAt ?? null,
          accuracyM: waypoint.accuracyM ?? null,
        },
      })),
    },
    null,
    2,
  );
}

export function downloadBlobFile(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  try {
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    anchor.rel = "noopener";
    anchor.click();
  } finally {
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}
