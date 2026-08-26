import { inflateSync } from "node:zlib";

export type Rgba = { r: number; g: number; b: number; a: number };

/** Read one 8-bit RGB(A) pixel from a Playwright PNG screenshot buffer. */
export function pngPixelAt(buffer: Buffer, x = 0, y = 0): Rgba {
  if (buffer.length < 8 || buffer.subarray(0, 8).toString("binary") !== "\x89PNG\r\n\x1a\n") {
    throw new Error("not a PNG");
  }
  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  const idat: Buffer[] = [];
  while (offset + 8 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.subarray(offset + 4, offset + 8).toString("binary");
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8] ?? 0;
      colorType = data[9] ?? 0;
    } else if (type === "IDAT") {
      idat.push(data);
    } else if (type === "IEND") {
      break;
    }
    offset += 12 + length;
  }
  if (bitDepth !== 8 || (colorType !== 2 && colorType !== 6)) {
    throw new Error(`unsupported PNG (depth=${bitDepth} type=${colorType})`);
  }
  const bpp = colorType === 6 ? 4 : 3;
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * bpp;
  const rows: Buffer[] = [];
  let src = 0;
  for (let row = 0; row < height; row++) {
    const filter = raw[src] ?? 0;
    src += 1;
    const scan = Buffer.from(raw.subarray(src, src + stride));
    src += stride;
    if (filter === 1) {
      for (let i = 0; i < stride; i++) {
        scan[i] = ((scan[i] ?? 0) + (i >= bpp ? (scan[i - bpp] ?? 0) : 0)) & 255;
      }
    } else if (filter === 2) {
      const prev = rows[row - 1];
      for (let i = 0; i < stride; i++) {
        scan[i] = ((scan[i] ?? 0) + (prev?.[i] ?? 0)) & 255;
      }
    } else if (filter === 3) {
      const prev = rows[row - 1];
      for (let i = 0; i < stride; i++) {
        const left = i >= bpp ? (scan[i - bpp] ?? 0) : 0;
        const up = prev?.[i] ?? 0;
        scan[i] = ((scan[i] ?? 0) + Math.floor((left + up) / 2)) & 255;
      }
    } else if (filter === 4) {
      const prev = rows[row - 1];
      for (let i = 0; i < stride; i++) {
        const a = i >= bpp ? (scan[i - bpp] ?? 0) : 0;
        const b = prev?.[i] ?? 0;
        const c = i >= bpp ? (prev?.[i - bpp] ?? 0) : 0;
        scan[i] = ((scan[i] ?? 0) + paeth(a, b, c)) & 255;
      }
    } else if (filter !== 0) {
      throw new Error(`unsupported PNG filter ${filter}`);
    }
    rows.push(scan);
  }
  const px = Math.min(Math.max(0, Math.floor(x)), width - 1);
  const py = Math.min(Math.max(0, Math.floor(y)), height - 1);
  const i = px * bpp;
  const row = rows[py];
  if (!row) throw new Error("PNG row missing");
  return {
    r: row[i] ?? 0,
    g: row[i + 1] ?? 0,
    b: row[i + 2] ?? 0,
    a: bpp === 4 ? (row[i + 3] ?? 255) : 255,
  };
}

export function colorDistance(a: Rgba, b: Rgba): number {
  const dr = a.r - b.r;
  const dg = a.g - b.g;
  const db = a.b - b.b;
  return dr * dr + dg * dg + db * db;
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}
