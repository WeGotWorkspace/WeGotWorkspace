#!/usr/bin/env node
/**
 * Publish app icons: vector SVG wherever a browser takes one, PNG only where
 * a platform needs a bitmap.
 *
 * Source: `src/assets/app-icons/{app}.svg` — real vector SVG only, a full-bleed
 * square. Rejects SVG files that embed raster data (`<image`, `data:image`,
 * `base64`). Fills use CSS brand tokens (`var(--color-we-got-*)`) with a hex
 * fallback, nested in `--app-icon-layer-*` so in-app tiles can recolor. Cream
 * is `--color-we-got-soft`. White has no brand token and stays `#ffffff`.
 *
 * Output:
 *   - `public/app-icons/{app}.svg` — copied verbatim; the in-app tile, square
 *     (CSS rounds the tile).
 *   - `public/app-icons/{app}-favicon.svg` — the same artwork clipped to the
 *     tile radius (1/6 of the side), for `<link rel="icon">`. Browser tabs do
 *     not round icons themselves.
 *   - `public/pwa-icons/{app}-{180,192,512}.png` — opaque PNG-24, rendered from
 *     the SVG at each size. 180 is `apple-touch-icon`; 192 and 512 are the
 *     manifest icons. The 512 also serves as the maskable icon: the tile is
 *     full bleed, so the launcher mask only trims background.
 *   - `public/manifests/{app}.webmanifest` — PNG icons only, when the file exists.
 *
 * Install PNGs stay square and opaque: iOS and Android apply their own mask,
 * and transparent corners would flatten to the wrong color.
 *
 * WebKit uses `<link rel="apple-touch-icon">` when that link is in the document
 * head, and only then falls back to manifest icons. The SVG is not a manifest
 * icon: its fills use CSS variables, which an external image resolves only to
 * the fallbacks, and `sizes: "any"` would outrank the PNGs.
 *
 * `/` (the suite) installs and tabs from `home-pwa.svg`. `home.svg` stays the
 * in-app suite mark.
 *
 * Icon query strings come from `src/lib/pwa-icon-cache-version.json`. Bump
 * `version` there and re-run this script. Do not parse the TypeScript module.
 *
 * Requires librsvg (`rsvg-convert`) to render and ImageMagick 7 (`magick`) to
 * flatten to PNG-24. Do not call `convert`: on Windows that name is the
 * filesystem tool. librsvg does not resolve CSS variables, so the SVG goes
 * through `svgForRasterization` first.
 */
import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { assertFullBleedSquare } from "./pwa-icon-full-bleed.mjs";
import { roundedFaviconSvg, svgForRasterization } from "./pwa-icon-raster.mjs";

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
  "meet",
  "notes",
  "settings",
  "tasks",
];
/** Vector only: not in the home grid yet, so no tab or install icon. */
const FUTURE_APPS = ["reminders", "sheets", "ai"];
/** In-app suite mark. Its tab and install icons come from `home-pwa.svg`. */
const HOME_APP = "home";
const HOME_INSTALL_SOURCE = "home-pwa.svg";
const PNG_SIZES = [180, 192, 512];

const RASTER_EMBED_RE =
  /<image\b|data:image|xlink:href\s*=\s*["']data:|href\s*=\s*["']data:image|base64/i;

const cacheVersion = JSON.parse(readFileSync(cacheVersionPath, "utf8")).version;
if (typeof cacheVersion !== "string" || cacheVersion === "") {
  throw new Error(`Missing version in ${cacheVersionPath}`);
}

mkdirSync(uiDir, { recursive: true });
mkdirSync(pwaDir, { recursive: true });

function resolveBinary(bin, versionFlag, hint) {
  try {
    execFileSync(bin, [versionFlag], { stdio: "ignore" });
    return bin;
  } catch {
    throw new Error(hint);
  }
}

const magick = resolveBinary(
  "magick",
  "--version",
  "ImageMagick 7 is required (`magick`) to flatten install PNGs. Do not use `convert`: on Windows that name is the filesystem tool.",
);
const rsvg = resolveBinary(
  "rsvg-convert",
  "--version",
  "librsvg is required (`rsvg-convert`) to render install PNGs from the SVGs.",
);

function readSource(name) {
  const path = join(sourceDir, name);
  if (!existsSync(path)) throw new Error(`Missing vector source: ${path}`);
  const markup = readFileSync(path, "utf8");
  if (!/<svg[\s>]/i.test(markup)) throw new Error(`${name}: not valid SVG markup`);
  if (RASTER_EMBED_RE.test(markup)) {
    throw new Error(`${name}: SVG embeds raster data — use vector paths only`);
  }
  assertFullBleedSquare(name, markup);
  return markup;
}

const workDir = mkdtempSync(join(tmpdir(), "pwa-icons-"));

/**
 * Render at the target size (no resampling of a larger bitmap), then drop alpha.
 * `-strip` and no date chunks keep the bytes stable, so a re-run only changes
 * PNGs whose artwork changed.
 */
function writePngs(app, markup) {
  const flat = join(workDir, `${app}.svg`);
  writeFileSync(flat, svgForRasterization(markup));
  for (const size of PNG_SIZES) {
    const rendered = join(workDir, `${app}-${size}.png`);
    execFileSync(rsvg, ["-w", String(size), "-h", String(size), "-o", rendered, flat]);
    execFileSync(magick, [
      rendered,
      "-alpha",
      "off",
      "-strip",
      "-define",
      "png:exclude-chunks=date,time",
      `PNG24:${join(pwaDir, `${app}-${size}.png`)}`,
    ]);
  }
}

function manifestIcons(app) {
  const icon = (size, purpose) => ({
    src: `/pwa-icons/${app}-${size}.png?v=${cacheVersion}`,
    sizes: `${size}x${size}`,
    type: "image/png",
    purpose,
  });
  return [icon(192, "any"), icon(512, "any"), icon(512, "maskable")];
}

function writeManifestIcons(app) {
  const manifestPath = join(manifestsDir, `${app}.webmanifest`);
  if (!existsSync(manifestPath)) return;
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  manifest.icons = manifestIcons(app);
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
}

const published = new Set();
let failed = false;

function publish(app, { installSource, tabAndInstall }) {
  try {
    readSource(`${app}.svg`);
    copyFileSync(join(sourceDir, `${app}.svg`), join(uiDir, `${app}.svg`));
    published.add(`${app}.svg`);
    if (!tabAndInstall) {
      console.log(`Published vector icon for ${app}`);
      return;
    }
    const markup = readSource(installSource);
    writeFileSync(join(uiDir, `${app}-favicon.svg`), roundedFaviconSvg(markup));
    published.add(`${app}-favicon.svg`);
    writePngs(app, markup);
    writeManifestIcons(app);
    console.log(`Published vector icon, rounded favicon + install PNGs for ${app}`);
  } catch (err) {
    console.error(err.message);
    failed = true;
  }
}

for (const app of WORKSPACE_APPS)
  publish(app, { installSource: `${app}.svg`, tabAndInstall: true });
for (const app of FUTURE_APPS) publish(app, { tabAndInstall: false });
publish(HOME_APP, { installSource: HOME_INSTALL_SOURCE, tabAndInstall: true });

rmSync(workDir, { recursive: true, force: true });

// Drop outputs no longer produced (old maskable copies, future-app PNGs, the
// square home-pwa favicon) so `public/` holds only what the shell references.
const installApps = new Set([...WORKSPACE_APPS, HOME_APP]);
for (const name of readdirSync(uiDir)) {
  if (name.endsWith(".svg") && !published.has(name)) rmSync(join(uiDir, name));
}
for (const name of readdirSync(pwaDir)) {
  const match = name.match(/^(.+)-(\d+)\.png$/);
  if (!match || !installApps.has(match[1]) || !PNG_SIZES.includes(Number(match[2]))) {
    rmSync(join(pwaDir, name));
  }
}

for (const name of readdirSync(manifestsDir)) {
  if (!name.endsWith(".webmanifest")) continue;
  const app = name.slice(0, -".webmanifest".length);
  if (!installApps.has(app)) {
    console.error(`Manifest ${name} has no install icon source`);
    failed = true;
  }
}

if (failed) process.exit(1);
