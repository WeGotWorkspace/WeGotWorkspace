#!/usr/bin/env node
/**
 * Publish vector app icons for in-app UI and rasterize install PNGs.
 *
 * Canonical source: `src/assets/app-icons/{app}.svg` — real vector SVG only.
 * Rejects SVG files that embed raster data (`<image`, `data:image`, `base64`).
 *
 * Output:
 *   - `public/app-icons/{app}.svg` — copied verbatim for in-app UI
 *   - `public/app-icons/home-pwa.svg` — `/` favicon only; not the in-app suite mark
 *   - `public/pwa-icons/{app}-{180,192,512}.png` — opaque PNG-24
 *   - `public/pwa-icons/{app}-512-maskable.png` — same artwork at 80%, padded
 *   - `public/manifests/{app}.webmanifest` — PNG icons only, when the file exists
 *
 * WebKit uses `<link rel="apple-touch-icon">` when that link is in the document
 * head, and only then falls back to manifest icons. This shell injects both
 * links after hydration, so the manifest PNGs matter when Safari reads the
 * manifest and not the touch link. The source SVG is not a manifest icon: its
 * fills use CSS variables, which are unreliable in an external image, and
 * `sizes: "any"` would outrank the PNGs.
 *
 * Icon query strings come from `src/lib/pwa-icon-cache-version.json`. Bump
 * `version` there and re-run this script. Do not parse the TypeScript module.
 *
 * Switch-trigger inversion uses the in-app SVG with `--wai-*` CSS vars (see workspace-app-icon.css).
 * Brand fills nest a `--color-we-got-*` token inside that fallback. Rasterization
 * peels both layers down to the hex (see pwa-icon-raster.mjs). Cream is
 * `--color-we-got-soft`. White has no brand token and stays `#ffffff`.
 * `home-pwa.svg` is the `/` install tile and favicon. It is never inlined, so
 * its fills are brand tokens with a hex fallback and no `--wai-*` layer.
 * `home.svg` stays the in-app suite mark.
 *
 * SVG rasterization uses `rsvg-convert` (librsvg). ImageMagick 6's SVG renderer
 * drops `clip-path` glyphs. ImageMagick (`magick`, or `convert` on ImageMagick 6)
 * only flattens to opaque PNG-24 and builds the maskable canvas.
 */
import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { assertFullBleedSquare } from "./pwa-icon-full-bleed.mjs";
import { svgForRasterization } from "./pwa-icon-raster.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const packageDir = join(__dirname, "..");
const publicDir = join(packageDir, "public");
const sourceDir = join(packageDir, "src", "assets", "app-icons");
const uiDir = join(publicDir, "app-icons");
const pwaDir = join(publicDir, "pwa-icons");
const manifestsDir = join(publicDir, "manifests");
const cacheVersionPath = join(packageDir, "src", "lib", "pwa-icon-cache-version.json");

const WORKSPACE_APPS = [
  "admin",
  "calendar",
  "contacts",
  "docs",
  "drive",
  "mail",
  "meet",
  "notes",
  "settings",
  "tasks",
];
const FUTURE_APPS = ["reminders"];
/** Shell / suite PWA manifest (home.webmanifest) — full-bleed launcher tile, not a home-grid app. */
const SHELL_APPS = ["home"];
/**
 * `/` install PNGs and favicon. Kept off `home.svg`, which is the in-app suite mark.
 */
const HOME_INSTALL_SOURCE = "home-pwa.svg";
const ALL_APPS = [...WORKSPACE_APPS, ...FUTURE_APPS, ...SHELL_APPS];
const INSTALL_APPS = [...WORKSPACE_APPS, ...SHELL_APPS];
const RASTER_SIZES = [180, 192, 512];
/**
 * Android's maskable safe zone is a circle with diameter 80% of the icon.
 * These tiles draw glyphs to the edges, so scaling to 80% (410px) still puts
 * that artwork outside the circle. The largest square inside the circle is
 * `diameter / sqrt(2)`.
 */
const MASKABLE_CANVAS = 512;
const MASKABLE_ART_SIZE = Math.floor((MASKABLE_CANVAS * 0.8) / Math.SQRT2);

const RASTER_EMBED_RE =
  /<image\b|data:image|xlink:href\s*=\s*["']data:|href\s*=\s*["']data:image|base64/i;

const cacheVersionFile = JSON.parse(readFileSync(cacheVersionPath, "utf8"));
const cacheVersion = cacheVersionFile.version;
if (typeof cacheVersion !== "string" || cacheVersion === "") {
  throw new Error(`Missing version in ${cacheVersionPath}`);
}

mkdirSync(sourceDir, { recursive: true });
mkdirSync(uiDir, { recursive: true });
mkdirSync(pwaDir, { recursive: true });

function resolveBinary(bins, hint) {
  for (const bin of bins) {
    try {
      execFileSync(bin, ["--version"], { stdio: "ignore" });
      return bin;
    } catch {
      try {
        execFileSync(bin, ["-version"], { stdio: "ignore" });
        return bin;
      } catch {
        // Try the next binary.
      }
    }
  }
  throw new Error(hint);
}

function resolveMagick() {
  return resolveBinary(
    ["magick", "convert"],
    "ImageMagick is required (`magick` or `convert`) to flatten install PNGs.",
  );
}

function resolveRsvg() {
  return resolveBinary(
    ["rsvg-convert"],
    "librsvg is required (`rsvg-convert`) to rasterize install icons. ImageMagick 6 drops clip-path glyphs.",
  );
}

const magick = resolveMagick();
const rsvg = resolveRsvg();

function assertVectorSvg(app, svgPath) {
  const markup = readFileSync(svgPath, "utf8");
  if (!/<svg[\s>]/i.test(markup)) {
    throw new Error(`${app}: not valid SVG markup (${svgPath})`);
  }
  if (RASTER_EMBED_RE.test(markup)) {
    throw new Error(`${app}: SVG embeds raster data — use vector paths only (${svgPath})`);
  }
  return markup;
}

function rasterizePng(rasterSvg, size, dest) {
  const raw = `${dest}.raw.png`;
  execFileSync(rsvg, ["-w", String(size), "-h", String(size), rasterSvg, "-o", raw], {
    stdio: "inherit",
  });
  execFileSync(
    magick,
    [raw, "-background", "white", "-alpha", "remove", "-alpha", "off", `PNG24:${dest}`],
    { stdio: "inherit" },
  );
  rmSync(raw, { force: true });
}

/** Sample a few pixels inward so a flattened transparent corner cannot become the pad color. */
function inwardBackground(pngPath) {
  const raw = execFileSync(magick, [pngPath, "-format", "%[hex:p{8,8}]", "info:"], {
    encoding: "utf8",
  }).trim();
  const hex = raw.replace(/^#/, "").slice(0, 6);
  if (!/^[0-9a-fA-F]{6}$/.test(hex)) {
    throw new Error(`Could not sample a background color from ${pngPath} (got ${raw})`);
  }
  return `#${hex}`;
}

function writeMaskable(sourcePng, dest) {
  const background = inwardBackground(sourcePng);
  execFileSync(
    magick,
    [
      sourcePng,
      "-filter",
      "Lanczos",
      "-resize",
      `${MASKABLE_ART_SIZE}x${MASKABLE_ART_SIZE}`,
      "-background",
      background,
      "-gravity",
      "center",
      "-extent",
      `${MASKABLE_CANVAS}x${MASKABLE_CANVAS}`,
      "-alpha",
      "off",
      `PNG24:${dest}`,
    ],
    { stdio: "inherit" },
  );
}

function manifestIcons(app) {
  return [
    {
      src: `/pwa-icons/${app}-192.png?v=${cacheVersion}`,
      sizes: "192x192",
      type: "image/png",
      purpose: "any",
    },
    {
      src: `/pwa-icons/${app}-512.png?v=${cacheVersion}`,
      sizes: "512x512",
      type: "image/png",
      purpose: "any",
    },
    {
      src: `/pwa-icons/${app}-512-maskable.png?v=${cacheVersion}`,
      sizes: "512x512",
      type: "image/png",
      purpose: "maskable",
    },
  ];
}

function writeManifestIcons(app) {
  const manifestPath = join(manifestsDir, `${app}.webmanifest`);
  if (!existsSync(manifestPath)) return;
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  manifest.icons = manifestIcons(app);
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
}

let failed = false;

for (const app of ALL_APPS) {
  const srcSvg = join(sourceDir, `${app}.svg`);
  if (!existsSync(srcSvg)) {
    console.error(`Missing vector source: ${srcSvg}`);
    failed = true;
    continue;
  }

  let markup;
  try {
    markup = assertVectorSvg(app, srcSvg);
    assertFullBleedSquare(app, markup);
  } catch (err) {
    console.error(err.message);
    failed = true;
    continue;
  }

  const destSvg = join(uiDir, `${app}.svg`);
  copyFileSync(srcSvg, destSvg);

  let rasterMarkup = markup;
  if (app === "home") {
    const installSrc = join(sourceDir, HOME_INSTALL_SOURCE);
    if (!existsSync(installSrc)) {
      console.error(`Missing home install source: ${installSrc}`);
      failed = true;
      continue;
    }
    try {
      rasterMarkup = assertVectorSvg("home-pwa", installSrc);
      assertFullBleedSquare("home-pwa", rasterMarkup);
    } catch (err) {
      console.error(err.message);
      failed = true;
      continue;
    }
    copyFileSync(installSrc, join(uiDir, HOME_INSTALL_SOURCE));
  }

  if (INSTALL_APPS.includes(app)) {
    const rasterSvg = join(pwaDir, `.${app}-raster.svg`);
    writeFileSync(rasterSvg, svgForRasterization(rasterMarkup));
    for (const size of RASTER_SIZES) {
      rasterizePng(rasterSvg, size, join(pwaDir, `${app}-${size}.png`));
    }
    writeMaskable(join(pwaDir, `${app}-512.png`), join(pwaDir, `${app}-512-maskable.png`));
    rmSync(rasterSvg, { force: true });
    writeManifestIcons(app);
  }

  for (const legacy of [`${app}.png`, `${app}-glyph.png`, `${app}-glyph.svg`]) {
    rmSync(join(uiDir, legacy), { force: true });
  }

  const install = INSTALL_APPS.includes(app) ? " + install PNGs" : "";
  console.log(`Published vector icon${install} for ${app}`);
}

const manifestApps = new Set(INSTALL_APPS);
for (const name of readdirSync(manifestsDir)) {
  if (!name.endsWith(".webmanifest")) continue;
  const app = name.slice(0, -".webmanifest".length);
  if (!manifestApps.has(app)) {
    console.error(`Manifest ${name} has no install icon source`);
    failed = true;
  }
}

if (failed) {
  process.exit(1);
}
