import { afterEach, describe, expect, it, vi } from "vitest";
import {
  fitPhotoSize,
  MAX_PHOTO_OUTPUT_BYTES,
  prepareFieldPhoto,
  waypointKindLabel,
  waypointsGeoJson,
} from "./field-capture";

describe("field capture helpers", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("fits large images without stretching them", () => {
    expect(fitPhotoSize(4_000, 3_000)).toEqual({ width: 1_600, height: 1_200 });
    expect(fitPhotoSize(600, 800)).toEqual({ width: 600, height: 800 });
    expect(() => fitPhotoSize(0, 800)).toThrow(/invalid dimensions/i);
  });

  it("decodes pixels into a bounded new JPEG instead of preserving source metadata", async () => {
    const close = vi.fn();
    vi.stubGlobal("createImageBitmap", vi.fn(async () => ({ width: 4_000, height: 3_000, close })));
    const drawImage = vi.fn();
    const output = new Blob(["new-jpeg-pixels"], { type: "image/jpeg" });
    const canvas = {
      width: 0,
      height: 0,
      getContext: () => ({ fillStyle: "", fillRect: vi.fn(), drawImage }),
      toBlob: (callback: (blob: Blob) => void) => callback(output),
    };
    vi.stubGlobal("document", { createElement: () => canvas });
    const source = new Blob(["EXIF GPS=47,-122; camera-serial=private"], { type: "image/png" });

    const prepared = await prepareFieldPhoto(source);

    expect(prepared).toMatchObject({ width: 1_600, height: 1_200 });
    expect(prepared.blob.type).toBe("image/jpeg");
    expect(prepared.blob.size).toBeLessThanOrEqual(MAX_PHOTO_OUTPUT_BYTES);
    expect(await prepared.blob.text()).not.toContain("GPS=");
    expect(drawImage).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledOnce();
  });

  it("exports plain-language GeoJSON without storage-only fields", () => {
    const text = waypointsGeoJson("River Loop", [
      {
        id: "wp-1",
        packId: "private-pack-id",
        kind: "junction",
        lat: 47.2,
        lng: -122.5,
        note: "Take the left fork",
        recordedAt: "2026-08-22T12:00:00.000Z",
      },
    ]);
    const result = JSON.parse(text);
    expect(result.features[0]).toMatchObject({
      geometry: { coordinates: [-122.5, 47.2] },
      properties: { category: "Trail split", note: "Take the left fork" },
    });
    expect(text).not.toContain("private-pack-id");
    expect(waypointKindLabel("lkp")).toBe("Last known point");
  });
});
