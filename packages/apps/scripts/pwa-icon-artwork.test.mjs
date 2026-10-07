import { inflateSync } from "node:zlib";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { assertFullBleedSquare } from "./pwa-icon-full-bleed.mjs";
import { svgForRasterization } from "./pwa-icon-raster.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const sourceDir = join(here, "../src/assets/app-icons");
const pwaDir = join(here, "../public/pwa-icons");

/** Anti-aliased glyph edges stay under this per-channel distance from the pad color. */
const GLYPH_CHANNEL_DELTA = 8;
/** Extra radius so a glyph pixel on the circle boundary is not a flake. */
const CIRCLE_RADIUS_SLACK = 2;
const MASKABLE_CANVAS = 512;
const SAFE_DIAMETER_RATIO = 0.8;

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

function decodePng(path) {
  const data = readFileSync(path);
  if (data.subarray(0, 8).toString("binary") !== "\x89PNG\r\n\x1a\n") {
    throw new Error(`${path} is not a PNG`);
  }
  let offset = 8;
  let width = 0;
  let height = 0;
  let colorType = -1;
  let compressed = Buffer.alloc(0);
  while (offset < data.length) {
    const length = data.readUInt32BE(offset);
    const type = data.subarray(offset + 4, offset + 8).toString("ascii");
    const chunk = data.subarray(offset + 8, offset + 8 + length);
    offset += 12 + length;
    if (type === "IHDR") {
      width = chunk.readUInt32BE(0);
      height = chunk.readUInt32BE(4);
      colorType = chunk[9];
    } else if (type === "IDAT") {
      compressed = Buffer.concat([compressed, chunk]);
    } else if (type === "IEND") {
      break;
    }
  }
  if (colorType !== 2) {
    throw new Error(`${path} is not opaque RGB PNG-24 (color type ${colorType})`);
  }
  const raw = inflateSync(compressed);
  const rowLength = width * 3;
  const rgba = new Uint8Array(width * height * 4);
  let cursor = 0;
  let previous = Buffer.alloc(rowLength);
  for (let y = 0; y < height; y += 1) {
    const filter = raw[cursor];
    cursor += 1;
    const row = Buffer.from(raw.subarray(cursor, cursor + rowLength));
    cursor += rowLength;
    for (let x = 0; x < rowLength; x += 1) {
      const left = x >= 3 ? row[x - 3] : 0;
      const up = previous[x];
      const upLeft = x >= 3 ? previous[x - 3] : 0;
      if (filter === 1) row[x] = (row[x] + left) & 255;
      else if (filter === 2) row[x] = (row[x] + up) & 255;
      else if (filter === 3) row[x] = (row[x] + Math.floor((left + up) / 2)) & 255;
      else if (filter === 4) row[x] = (row[x] + paeth(left, up, upLeft)) & 255;
      else if (filter !== 0) throw new Error(`${path} uses PNG filter ${filter}`);
    }
    previous = row;
    for (let x = 0; x < width; x += 1) {
      const target = (y * width + x) * 4;
      rgba[target] = row[x * 3];
      rgba[target + 1] = row[x * 3 + 1];
      rgba[target + 2] = row[x * 3 + 2];
      rgba[target + 3] = 255;
    }
  }
  return { width, height, rgba };
}

function isGlyphPixel(rgba, index, background) {
  for (let channel = 0; channel < 3; channel += 1) {
    if (Math.abs(rgba[index + channel] - background[channel]) > GLYPH_CHANNEL_DELTA) return true;
  }
  return false;
}

const BRAND_ICON_TOKEN = {
  admin: "--color-we-got-dark",
  calendar: "--color-we-got-prince",
  contacts: "--color-we-got-sky",
  docs: "--color-we-got-blue",
  drive: "--color-we-got-brat",
  mail: "--color-we-got-red",
  meet: "--color-we-got-sand",
  notes: "--color-we-got-yellow",
  settings: "--color-we-got-dark",
  tasks: "--color-we-got-pink",
};

describe("svgForRasterization", () => {
  it("peels nested brand tokens down to the hex fallback", () => {
    expect(
      svgForRasterization(
        '<rect fill="var(--app-icon-layer-surface, var(--color-we-got-yellow, #ffc800))"/>',
      ),
    ).toBe('<rect fill="#ffc800"/>');
  });

  it("keeps a single-level white fallback", () => {
    expect(svgForRasterization('<rect fill="var(--app-icon-layer-foreground, #ffffff)"/>')).toBe(
      '<rect fill="#ffffff"/>',
    );
  });
});

describe("PWA icon artwork", () => {
  it("nests a brand token inside --app-icon-layer-* and keeps a hex fallback for install PNGs", () => {
    for (const [app, token] of Object.entries(BRAND_ICON_TOKEN)) {
      const markup = readFileSync(join(sourceDir, `${app}.svg`), "utf8");
      expect(markup, app).toMatch(
        new RegExp(
          `var\\(--app-icon-layer-(?:surface|foreground), var\\(${token}, #[0-9a-f]{6}\\)\\)`,
        ),
      );
      const raster = svgForRasterization(markup);
      expect(raster, app).not.toContain("var(");
      expect(raster, app).toMatch(/#[0-9a-f]{6}/);
    }
  });

  it("keeps the home install icon off the in-app suite mark", () => {
    const install = readFileSync(join(sourceDir, "home-pwa.svg"), "utf8");
    const inApp = readFileSync(join(sourceDir, "home.svg"), "utf8");

    expect(install).toContain('viewBox="0 0 60 60"');
    expect(install).toContain('fill="var(--color-we-got-dark, #003311)"');
    expect(install).toContain('fill="url(#home-pwa-clover)"');
    expect(install).toContain('stop-color="var(--color-we-got-blue, #0045ff)"');
    expect(install).toContain('stop-color="var(--color-we-got-brat, #8ace00)"');
    expect(install).not.toContain("--wai-");
    const raster = svgForRasterization(install);
    expect(raster).not.toContain("var(");
    expect(raster).toContain("#003311");
    expect(raster).toContain("#0045ff");
    expect(raster).toContain("#8ace00");
    expect(inApp).toContain('viewBox="0 0 270 270"');
    expect(inApp).not.toContain("linearGradient");
  });

  it("keeps every source SVG a full-bleed square", () => {
    const sources = readdirSync(sourceDir).filter((name) => name.endsWith(".svg"));
    expect(sources.length).toBeGreaterThan(0);
    for (const name of sources) {
      const markup = readFileSync(join(sourceDir, name), "utf8");
      expect(() => assertFullBleedSquare(name, markup)).not.toThrow();
    }
  });

  it("pads maskable icons with the SVG background and keeps glyphs inside the safe circle", () => {
    const maskable = readdirSync(pwaDir).filter((name) => name.endsWith("-512-maskable.png"));
    expect(maskable.length).toBeGreaterThan(0);
    const radius = (MASKABLE_CANVAS * SAFE_DIAMETER_RATIO) / 2 + CIRCLE_RADIUS_SLACK;
    const center = (MASKABLE_CANVAS - 1) / 2;

    for (const name of maskable) {
      const app = name.slice(0, -"-512-maskable.png".length);
      const sourceName = app === "home" ? "home-pwa.svg" : `${app}.svg`;
      const markup = readFileSync(join(sourceDir, sourceName), "utf8");
      const fill = assertFullBleedSquare(app, svgForRasterization(markup));
      const hex = /^#([0-9a-fA-F]{6})$/.exec(fill);
      expect(hex, `${app} background fill`).not.toBeNull();
      const background = [0, 2, 4].map((offset) =>
        Number.parseInt(hex[1].slice(offset, offset + 2), 16),
      );

      const { width, height, rgba } = decodePng(join(pwaDir, name));
      expect(width).toBe(MASKABLE_CANVAS);
      expect(height).toBe(MASKABLE_CANVAS);
      expect([rgba[0], rgba[1], rgba[2]], `${name} pixel (0,0)`).toEqual(background);

      const outside = [];
      for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
          const index = (y * width + x) * 4;
          if (!isGlyphPixel(rgba, index, background)) continue;
          const dx = x - center;
          const dy = y - center;
          if (Math.hypot(dx, dy) > radius) outside.push(`${x},${y}`);
        }
      }
      expect(outside, `${name} glyph pixels outside the safe circle`).toEqual([]);
    }
  });

  it("writes opaque RGB PNGs at 180, 192, and 512", () => {
    const apps = readdirSync(pwaDir)
      .filter((name) => name.endsWith("-180.png"))
      .map((name) => name.slice(0, -"-180.png".length));
    expect(apps.length).toBeGreaterThan(0);
    for (const app of apps) {
      for (const size of [180, 192, 512]) {
        const decoded = decodePng(join(pwaDir, `${app}-${size}.png`));
        expect(decoded.width).toBe(size);
        expect(decoded.height).toBe(size);
      }
    }
  });
});
