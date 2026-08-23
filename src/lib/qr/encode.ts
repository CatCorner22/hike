/**
 * Dependency-free QR encoder — byte mode, error-correction level M, versions 1–15.
 *
 * Exists so a hiker can hand their position, ICE details, or the SAR dossier to ANY
 * camera phone with zero connectivity: the other phone needs no app, no signal, and no
 * pairing — every stock camera reads QR. Runtime dependencies are deliberately zero
 * (nothing new to audit in the offline safety path); correctness is pinned by
 * round-trip tests that decode every matrix with an independent decoder (jsQR,
 * dev-only) rather than by trusting this implementation.
 *
 * EC level M (~15% codeword recovery) is the deliberate choice for a screen-to-camera
 * handoff: glare and screen dirt beat the marginal capacity of level L.
 */

const EC_LEVEL_M_BITS = 0b00;

/** [totalCodewords, ecPerBlock, [countA, sizeA], [countB, sizeB]] per version, EC-M. */
const VERSION_TABLE: Array<{
  total: number;
  ecPerBlock: number;
  groups: Array<[count: number, dataCodewords: number]>;
}> = [
  { total: 26, ecPerBlock: 10, groups: [[1, 16]] },
  { total: 44, ecPerBlock: 16, groups: [[1, 28]] },
  { total: 70, ecPerBlock: 26, groups: [[1, 44]] },
  { total: 100, ecPerBlock: 18, groups: [[2, 32]] },
  { total: 134, ecPerBlock: 24, groups: [[2, 43]] },
  { total: 172, ecPerBlock: 16, groups: [[4, 27]] },
  { total: 196, ecPerBlock: 18, groups: [[4, 31]] },
  { total: 242, ecPerBlock: 22, groups: [[2, 38], [2, 39]] },
  { total: 292, ecPerBlock: 22, groups: [[3, 36], [2, 37]] },
  { total: 346, ecPerBlock: 26, groups: [[4, 43], [1, 44]] },
  { total: 404, ecPerBlock: 30, groups: [[1, 50], [4, 51]] },
  { total: 466, ecPerBlock: 22, groups: [[6, 36], [2, 37]] },
  { total: 532, ecPerBlock: 22, groups: [[8, 37], [1, 38]] },
  { total: 581, ecPerBlock: 24, groups: [[4, 40], [5, 41]] },
  { total: 655, ecPerBlock: 24, groups: [[5, 41], [5, 42]] },
];

// Invariant checked below: the outermost alignment coordinate is always size − 7.
const ALIGNMENT_POSITIONS: number[][] = [
  [],
  [6, 18],
  [6, 22],
  [6, 26],
  [6, 30],
  [6, 34],
  [6, 22, 38],
  [6, 24, 42],
  [6, 26, 46],
  [6, 28, 50],
  [6, 30, 54],
  [6, 32, 58],
  [6, 34, 62],
  [6, 26, 46, 66],
  [6, 26, 48, 70],
];

// GF(256) with the QR primitive polynomial x^8 + x^4 + x^3 + x^2 + 1 (0x11d).
const GF_EXP = new Uint8Array(512);
const GF_LOG = new Uint8Array(256);
(() => {
  let x = 1;
  for (let i = 0; i < 255; i += 1) {
    GF_EXP[i] = x;
    GF_LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i += 1) GF_EXP[i] = GF_EXP[i - 255];
})();

for (let v = 2; v <= ALIGNMENT_POSITIONS.length; v += 1) {
  const positions = ALIGNMENT_POSITIONS[v - 1];
  const expected = 17 + v * 4 - 7;
  if (positions[positions.length - 1] !== expected) {
    throw new Error(`QR alignment table wrong for version ${v}: last must be ${expected}`);
  }
}

function gfMul(a: number, b: number): number {
  if (a === 0 || b === 0) return 0;
  return GF_EXP[GF_LOG[a] + GF_LOG[b]];
}

function rsGeneratorPoly(degree: number): Uint8Array {
  let poly = new Uint8Array([1]);
  for (let d = 0; d < degree; d += 1) {
    const next = new Uint8Array(poly.length + 1);
    for (let i = 0; i < poly.length; i += 1) {
      next[i] ^= gfMul(poly[i], GF_EXP[d]);
      next[i + 1] ^= poly[i];
    }
    poly = next;
  }
  return poly.reverse();
}

/** Polynomial long division over GF(256); gen[0] is the leading (=1) coefficient. */
function rsRemainder(data: Uint8Array, ecLength: number): Uint8Array {
  const gen = rsGeneratorPoly(ecLength);
  const buffer = new Uint8Array(data.length + ecLength);
  buffer.set(data);
  for (let i = 0; i < data.length; i += 1) {
    const factor = buffer[i];
    if (factor === 0) continue;
    for (let j = 1; j < gen.length; j += 1) {
      buffer[i + j] ^= gfMul(gen[j], factor);
    }
  }
  return buffer.slice(data.length);
}

class BitBuffer {
  bits: number[] = [];
  push(value: number, length: number) {
    for (let i = length - 1; i >= 0; i -= 1) this.bits.push((value >> i) & 1);
  }
  get length() {
    return this.bits.length;
  }
}

export interface QrMatrix {
  size: number;
  /** modules[y][x] === true means dark. */
  modules: boolean[][];
  version: number;
}

function utf8Bytes(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

function pickVersion(byteLength: number): number | null {
  for (let v = 1; v <= VERSION_TABLE.length; v += 1) {
    const table = VERSION_TABLE[v - 1];
    const dataCodewords = table.groups.reduce((sum, [count, size]) => sum + count * size, 0);
    const countBits = v >= 10 ? 16 : 8;
    const capacityBits = dataCodewords * 8 - 4 - countBits;
    if (byteLength * 8 <= capacityBits) return v;
  }
  return null;
}

function buildCodewords(bytes: Uint8Array, version: number): Uint8Array {
  const table = VERSION_TABLE[version - 1];
  const dataCodewords = table.groups.reduce((sum, [count, size]) => sum + count * size, 0);
  const buffer = new BitBuffer();
  buffer.push(0b0100, 4);
  buffer.push(bytes.length, version >= 10 ? 16 : 8);
  for (const byte of bytes) buffer.push(byte, 8);
  // Terminator, byte alignment, then the alternating pad codewords the spec requires.
  buffer.push(0, Math.min(4, dataCodewords * 8 - buffer.length));
  while (buffer.length % 8 !== 0) buffer.push(0, 1);
  const padBytes = [0xec, 0x11];
  let padIndex = 0;
  while (buffer.length < dataCodewords * 8) {
    buffer.push(padBytes[padIndex % 2], 8);
    padIndex += 1;
  }

  const data = new Uint8Array(dataCodewords);
  for (let i = 0; i < dataCodewords; i += 1) {
    let byte = 0;
    for (let b = 0; b < 8; b += 1) byte = (byte << 1) | buffer.bits[i * 8 + b];
    data[i] = byte;
  }

  // Split into blocks, compute EC per block, then interleave data and EC.
  const blocks: Array<{ data: Uint8Array; ec: Uint8Array }> = [];
  let offset = 0;
  for (const [count, size] of table.groups) {
    for (let i = 0; i < count; i += 1) {
      const blockData = data.slice(offset, offset + size);
      offset += size;
      blocks.push({ data: blockData, ec: rsRemainder(blockData, table.ecPerBlock) });
    }
  }
  const out = new Uint8Array(table.total);
  let outIndex = 0;
  const maxData = Math.max(...blocks.map((block) => block.data.length));
  for (let i = 0; i < maxData; i += 1) {
    for (const block of blocks) {
      if (i < block.data.length) out[outIndex++] = block.data[i];
    }
  }
  for (let i = 0; i < table.ecPerBlock; i += 1) {
    for (const block of blocks) out[outIndex++] = block.ec[i];
  }
  return out;
}

function bchRemainder(value: number, generator: number, genDegree: number, totalDegree: number): number {
  // Data occupies the high bits (shifted up by the generator degree); the remainder of
  // the polynomial division fills the low genDegree bits.
  let remainder = value << genDegree;
  for (let bit = totalDegree; bit >= genDegree; bit -= 1) {
    if (remainder & (1 << bit)) remainder ^= generator << (bit - genDegree);
  }
  return remainder;
}

function formatBits(mask: number): number {
  const data = (EC_LEVEL_M_BITS << 3) | mask;
  const bch = bchRemainder(data, 0b10100110111, 10, 14);
  return ((data << 10) | bch) ^ 0b101010000010010;
}

function versionBits(version: number): number {
  const bch = bchRemainder(version, 0b1111100100101, 12, 17);
  return (version << 12) | bch;
}

type Matrix = Array<Array<boolean | null>>;

function placeFinder(matrix: Matrix, top: number, left: number) {
  for (let y = -1; y <= 7; y += 1) {
    for (let x = -1; x <= 7; x += 1) {
      const yy = top + y;
      const xx = left + x;
      if (yy < 0 || yy >= matrix.length || xx < 0 || xx >= matrix.length) continue;
      const inOuter = y >= 0 && y <= 6 && x >= 0 && x <= 6;
      const onRing = inOuter && (y === 0 || y === 6 || x === 0 || x === 6);
      const inCore = y >= 2 && y <= 4 && x >= 2 && x <= 4;
      matrix[yy][xx] = onRing || inCore;
    }
  }
}

function buildMatrix(version: number, codewords: Uint8Array, mask: number): boolean[][] {
  const size = 17 + version * 4;
  const matrix: Matrix = Array.from({ length: size }, () => Array<boolean | null>(size).fill(null));

  placeFinder(matrix, 0, 0);
  placeFinder(matrix, 0, size - 7);
  placeFinder(matrix, size - 7, 0);

  const alignment = ALIGNMENT_POSITIONS[version - 1];
  for (const cy of alignment) {
    for (const cx of alignment) {
      if (matrix[cy][cx] !== null) continue; // overlaps a finder
      for (let y = -2; y <= 2; y += 1) {
        for (let x = -2; x <= 2; x += 1) {
          matrix[cy + y][cx + x] = Math.max(Math.abs(y), Math.abs(x)) !== 1;
        }
      }
    }
  }

  for (let i = 8; i < size - 8; i += 1) {
    if (matrix[6][i] === null) matrix[6][i] = i % 2 === 0;
    if (matrix[i][6] === null) matrix[i][6] = i % 2 === 0;
  }

  // Dark module.
  matrix[size - 8][8] = true;

  // Reserve format areas (filled after masking decision; reserving keeps data out).
  const formatCells: Array<[number, number]> = [];
  for (let i = 0; i <= 8; i += 1) {
    if (i !== 6) {
      formatCells.push([8, i]);
      formatCells.push([i, 8]);
    }
  }
  for (let i = 0; i < 8; i += 1) formatCells.push([8, size - 1 - i]);
  for (let i = 0; i < 7; i += 1) formatCells.push([size - 1 - i, 8]);
  for (const [y, x] of formatCells) if (matrix[y][x] === null) matrix[y][x] = false;

  if (version >= 7) {
    const bits = versionBits(version);
    for (let i = 0; i < 18; i += 1) {
      const bit = ((bits >> i) & 1) === 1;
      matrix[Math.floor(i / 3)][size - 11 + (i % 3)] = bit;
      matrix[size - 11 + (i % 3)][Math.floor(i / 3)] = bit;
    }
  }

  // Zigzag data placement with the mask applied on the way in.
  let bitIndex = 0;
  const totalBits = codewords.length * 8;
  let dataCells = 0;
  const bitAt = (index: number) => ((codewords[index >> 3] >> (7 - (index & 7))) & 1) === 1;
  let upward = true;
  for (let col = size - 1; col > 0; col -= 2) {
    if (col === 6) col -= 1;
    for (let step = 0; step < size; step += 1) {
      const y = upward ? size - 1 - step : step;
      for (const x of [col, col - 1]) {
        if (matrix[y][x] !== null) continue;
        const dataBit = bitIndex < totalBits ? bitAt(bitIndex) : false;
        bitIndex += 1;
        dataCells += 1;
        matrix[y][x] = maskBit(mask, y, x) ? !dataBit : dataBit;
      }
    }
    upward = !upward;
  }

  // Structural invariant: the free cells must hold exactly the codeword bits plus the
  // version's remainder bits. A mismatch means a function pattern is misplaced and the
  // symbol would be undecodable — fail loudly here, never emit a broken code.
  const REMAINDER_BITS = [0, 7, 7, 7, 7, 7, 0, 0, 0, 0, 0, 0, 0, 3, 3];
  if (dataCells !== totalBits + REMAINDER_BITS[version - 1]) {
    throw new Error(
      `QR layout error: version ${version} has ${dataCells} data cells for ${totalBits} codeword bits (+${REMAINDER_BITS[version - 1]} remainder)`,
    );
  }

  // Format info, masked per spec.
  const format = formatBits(mask);
  const formatBit = (i: number) => ((format >> i) & 1) === 1;
  for (let i = 0; i <= 5; i += 1) matrix[8][i] = formatBit(14 - i);
  matrix[8][7] = formatBit(8);
  matrix[8][8] = formatBit(7);
  matrix[7][8] = formatBit(6);
  // Continuing up the column: (5,8) carries bit 5 down to (0,8) carrying bit 0.
  for (let i = 0; i <= 5; i += 1) matrix[5 - i][8] = formatBit(5 - i);
  for (let i = 0; i < 7; i += 1) matrix[size - 1 - i][8] = formatBit(14 - i);
  for (let i = 0; i < 8; i += 1) matrix[8][size - 8 + i] = formatBit(7 - i);
  matrix[size - 8][8] = true;

  return matrix.map((row) => row.map((cell) => cell === true));
}

function maskBit(mask: number, y: number, x: number): boolean {
  switch (mask) {
    case 0: return (y + x) % 2 === 0;
    case 1: return y % 2 === 0;
    case 2: return x % 3 === 0;
    case 3: return (y + x) % 3 === 0;
    case 4: return (Math.floor(y / 2) + Math.floor(x / 3)) % 2 === 0;
    case 5: return ((y * x) % 2) + ((y * x) % 3) === 0;
    case 6: return (((y * x) % 2) + ((y * x) % 3)) % 2 === 0;
    default: return (((y + x) % 2) + ((y * x) % 3)) % 2 === 0;
  }
}

function penaltyScore(matrix: boolean[][]): number {
  const size = matrix.length;
  let score = 0;
  // Rule 1: runs of 5+ same-color modules, rows and columns.
  for (let pass = 0; pass < 2; pass += 1) {
    for (let a = 0; a < size; a += 1) {
      let run = 1;
      for (let b = 1; b < size; b += 1) {
        const current = pass === 0 ? matrix[a][b] : matrix[b][a];
        const previous = pass === 0 ? matrix[a][b - 1] : matrix[b - 1][a];
        if (current === previous) {
          run += 1;
          if (b === size - 1 && run >= 5) score += run - 2;
        } else {
          if (run >= 5) score += run - 2;
          run = 1;
        }
      }
    }
  }
  // Rule 2: 2x2 blocks of one color.
  for (let y = 0; y < size - 1; y += 1) {
    for (let x = 0; x < size - 1; x += 1) {
      const c = matrix[y][x];
      if (matrix[y][x + 1] === c && matrix[y + 1][x] === c && matrix[y + 1][x + 1] === c) score += 3;
    }
  }
  // Rule 3: finder-like 1:1:3:1:1 pattern with 4-module light run on either side.
  const pattern1 = [true, false, true, true, true, false, true, false, false, false, false];
  const pattern2 = [false, false, false, false, true, false, true, true, true, false, true];
  for (let pass = 0; pass < 2; pass += 1) {
    for (let a = 0; a < size; a += 1) {
      for (let b = 0; b <= size - 11; b += 1) {
        let match1 = true;
        let match2 = true;
        for (let k = 0; k < 11; k += 1) {
          const cell = pass === 0 ? matrix[a][b + k] : matrix[b + k][a];
          if (cell !== pattern1[k]) match1 = false;
          if (cell !== pattern2[k]) match2 = false;
        }
        if (match1) score += 40;
        if (match2) score += 40;
      }
    }
  }
  // Rule 4: dark-module balance.
  let dark = 0;
  for (const row of matrix) for (const cell of row) if (cell) dark += 1;
  const percent = (dark * 100) / (size * size);
  score += Math.floor(Math.abs(percent - 50) / 5) * 10;
  return score;
}

/**
 * Encode UTF-8 text into a QR matrix (byte mode, EC level M). Returns null when the
 * text exceeds version 15's capacity (~410 bytes) — the caller should shorten the
 * payload rather than receive a false success.
 */
export function encodeQr(text: string): QrMatrix | null {
  if (typeof text !== "string" || text.length === 0) return null;
  const bytes = utf8Bytes(text);
  const version = pickVersion(bytes.length);
  if (version == null) return null;
  const codewords = buildCodewords(bytes, version);
  let best: { matrix: boolean[][]; score: number } | null = null;
  for (let mask = 0; mask < 8; mask += 1) {
    const matrix = buildMatrix(version, codewords, mask);
    const score = penaltyScore(matrix);
    if (!best || score < best.score) best = { matrix, score };
  }
  return { size: best!.matrix.length, modules: best!.matrix, version };
}

/** Render as an SVG path string (1 unit per module) for crisp scaling on any screen. */
export function qrToSvgPath(qr: QrMatrix): string {
  const parts: string[] = [];
  for (let y = 0; y < qr.size; y += 1) {
    for (let x = 0; x < qr.size; x += 1) {
      if (qr.modules[y][x]) parts.push(`M${x} ${y}h1v1h-1z`);
    }
  }
  return parts.join("");
}
