import { describe, expect, it } from "vitest";
import jsQR from "jsqr";
import { encodeQr, qrToSvgPath } from "./encode";

/**
 * Correctness is pinned by an INDEPENDENT decoder, not by trusting the encoder: every
 * matrix is rasterized and decoded with jsQR (dev-only dependency). A wrong table, a
 * wrong Reed-Solomon term, or a wrong mask bit fails these loudly — which is the only
 * acceptable failure mode for the thing that hands a SAR grid to a stranger's phone.
 */
function decode(matrixText: string): string | null {
  const qr = encodeQr(matrixText);
  if (!qr) return null;
  const scale = 4;
  const quiet = 4 * scale;
  const size = qr.size * scale + quiet * 2;
  const rgba = new Uint8ClampedArray(size * size * 4);
  rgba.fill(255);
  for (let y = 0; y < qr.size; y += 1) {
    for (let x = 0; x < qr.size; x += 1) {
      if (!qr.modules[y][x]) continue;
      for (let dy = 0; dy < scale; dy += 1) {
        for (let dx = 0; dx < scale; dx += 1) {
          const py = quiet + y * scale + dy;
          const px = quiet + x * scale + dx;
          const offset = (py * size + px) * 4;
          rgba[offset] = 0;
          rgba[offset + 1] = 0;
          rgba[offset + 2] = 0;
        }
      }
    }
  }
  const result = jsQR(rgba, size, size);
  return result?.data ?? null;
}

describe("QR round-trip through an independent decoder", () => {
  it("encodes a SAR position handoff exactly", () => {
    const dossier =
      "SAR HANDOFF — Pat Doe, party of 2. LKP 11S KB 76448 38712 (USNG) at 2035Z 22 AUG 2026. " +
      "Moving south on Mist Trail toward Vernal Fall. Medical: bee-sting allergy, carries epi. " +
      "Phone 555-0100 (text first).";
    expect(decode(dossier)).toBe(dossier);
  });

  it("round-trips every version from tiny to near-capacity", () => {
    for (const length of [1, 10, 13, 14, 20, 60, 100, 150, 210, 300, 400]) {
      const payload = "K".repeat(length);
      expect(decode(payload), `${length} chars`).toBe(payload);
    }
  });

  it("survives varied byte content including UTF-8 and URL payloads", () => {
    const samples = [
      "geo:37.7459,-119.5936",
      "https://example.test/plan?id=abc-123&x=1",
      "Grid → mag: subtract 15.0° — café ¤ ümlaut",
      JSON.stringify({ usng: "11S KB 76448 38712", t: "2026-08-22T20:35:00Z", ok: false }),
    ];
    for (const sample of samples) {
      expect(decode(sample), sample).toBe(sample);
    }
  });

  it("round-trips deterministic pseudo-random payloads", () => {
    let seed = 0x1234;
    const nextChar = () => {
      seed = (seed * 48271) % 0x7fffffff;
      return String.fromCharCode(32 + (seed % 95));
    };
    for (let round = 0; round < 8; round += 1) {
      const length = 5 + ((round * 53) % 260);
      const payload = Array.from({ length }, nextChar).join("");
      expect(decode(payload), `round ${round}`).toBe(payload);
    }
  });

  it("refuses oversized payloads instead of silently truncating", () => {
    expect(encodeQr("x".repeat(2000))).toBeNull();
    expect(encodeQr("")).toBeNull();
  });

  it("emits an SVG path with one square per dark module", () => {
    const qr = encodeQr("test")!;
    const path = qrToSvgPath(qr);
    const darkCount = qr.modules.flat().filter(Boolean).length;
    expect(path.match(/h1v1h-1z/g)).toHaveLength(darkCount);
  });
});
