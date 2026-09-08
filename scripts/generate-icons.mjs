import { deflateSync } from "node:zlib";
import { writeFileSync } from "node:fs";

function crc32(buf) {
  let c = ~0;
  for (const b of buf) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  return ~c >>> 0;
}

function chunk(type, data) {
  const t = Buffer.from(type);
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([t, data])));
  return Buffer.concat([len, t, data, crc]);
}

function png(size) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  const mid = size / 2;
  const rOuter = size * 0.46;
  const rInner = size * 0.18;
  for (let y = 0; y < size; y++) {
    const row = y * (size * 4 + 1);
    raw[row] = 0;
    for (let x = 0; x < size; x++) {
      const dx = x - mid + 0.5;
      const dy = y - mid + 0.5;
      const d = Math.hypot(dx, dy);
      const i = row + 1 + x * 4;
      if (d <= rOuter) {
        raw[i] = 22;
        raw[i + 1] = 163;
        raw[i + 2] = 74;
        raw[i + 3] = 255;
        if (Math.abs(dx) < size * 0.08 && dy > -rOuter * 0.55 && dy < rOuter * 0.4) {
          raw[i] = 255;
          raw[i + 1] = 255;
          raw[i + 2] = 255;
        }
        if (d < rInner && dy < 0) {
          raw[i] = 255;
          raw[i + 1] = 255;
          raw[i + 2] = 255;
        }
      } else {
        raw[i + 3] = 0;
      }
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/**
 * App Store / home-screen icon: full-square, RGB with NO alpha channel —
 * Apple rejects a 1024 marketing icon that carries transparency, and iOS
 * composites its own corner mask. Same compass motif on the brand green.
 */
function pngOpaque(size) {
  const raw = Buffer.alloc((size * 3 + 1) * size);
  const mid = size / 2;
  const rOuter = size * 0.46;
  const rInner = size * 0.18;
  for (let y = 0; y < size; y++) {
    const row = y * (size * 3 + 1);
    raw[row] = 0;
    for (let x = 0; x < size; x++) {
      const dx = x - mid + 0.5;
      const dy = y - mid + 0.5;
      const d = Math.hypot(dx, dy);
      const i = row + 1 + x * 3;
      // Deep green field, brighter green disc, white needle — no transparency.
      if (d <= rOuter) {
        raw[i] = 22;
        raw[i + 1] = 163;
        raw[i + 2] = 74;
        if (Math.abs(dx) < size * 0.08 && dy > -rOuter * 0.55 && dy < rOuter * 0.4) {
          raw[i] = 255;
          raw[i + 1] = 255;
          raw[i + 2] = 255;
        }
        if (d < rInner && dy < 0) {
          raw[i] = 255;
          raw[i + 1] = 255;
          raw[i + 2] = 255;
        }
      } else {
        raw[i] = 6;
        raw[i + 1] = 78;
        raw[i + 2] = 59;
      }
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

writeFileSync("public/icons/icon-192.png", png(192));
writeFileSync("public/icons/icon-512.png", png(512));
writeFileSync("public/icons/apple-touch-icon.png", pngOpaque(180));
writeFileSync(
  "ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png",
  pngOpaque(1024),
);
console.log("wrote 192, 512, apple-touch 180, and app-store 1024 icons");
