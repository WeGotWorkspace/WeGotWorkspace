#!/usr/bin/env node
/**
 * Publish vector app icons for in-app UI and the supplied install PNGs.
 *
 * Canonical vector source: `src/assets/app-icons/{app}.svg` — real vector SVG only.
 * Rejects SVG files that embed raster data (`<image`, `data:image`, `base64`).
 * Fills use CSS brand tokens (`var(--color-we-got-*)`) nested in
 * `--app-icon-layer-*` so in-app tiles can recolor. Cream is `--color-we-got-soft`.
 * White has no brand token and stays `#ffffff`.
 *
 * Canonical install artwork: `src/assets/app-icons/raster/{app}.png`.
 * Use these tiles as-is. Do not redraw them from the SVGs. Resize only when a
 * published size is not already that pixel size.
 *
 * Output:
 *   - `public/app-icons/{app}.svg` — copied verbatim for in-app UI
 *   - `public/app-icons/home-pwa.svg` — `/` favicon only; not the in-app suite mark
 *   - `public/pwa-icons/{app}-{180,192,512}.png` — opaque PNG-24 from the raster master
 *   - `public/pwa-icons/{app}-512-maskable.png` — the same full-bleed 512 PNG
 *   - `public/manifests/{app}.webmanifest` — PNG icons only, when the file exists
 *
 * Maskable used to scale artwork onto the inscribed safe square. Edge-bleed
 * tiles and already-inset glyphs then landed at different scales, so some
 * launcher icons looked smaller than others. Every install size now uses the
 * supplied PNG.
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
 * `home-pwa.svg` is the `/` favicon. It is never inlined, so its fills are
 * brand tokens with a hex fallback and no `--app-icon-layer-*` layer.
 * `home.svg` stays the in-app suite mark. Install PNGs for `/` come from
 * `raster/home.png`, not from either SVG.
 *
 * ImageMagick 7 (`magick`) flattens to opaque PNG-24 and resizes. Do not call
 * `convert`: on Windows that name is the filesystem tool.
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

const __dirname = dirname(fileURLToPath(import.meta.url));
const packageDir = join(__dirname, "..");
const publicDir = join(packageDir, "public");
const sourceDir = join(packageDir, "src", "assets", "app-icons");
const rasterDir = join(sourceDir, "raster");
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
const FUTURE_APPS = ["reminders", "sheets", "ai"];
/** Shell / suite PWA manifest (home.webmanifest) — full-bleed launcher tile, not a home-grid app. */
const SHELL_APPS = ["home"];
/**
 * `/` install PNGs and favicon. Kept off `home.svg`, which is the in-app suite mark.
 */
const HOME_INSTALL_SOURCE = "home-pwa.svg";
const ALL_APPS = [...WORKSPACE_APPS, ...FUTURE_APPS, ...SHELL_APPS];
const INSTALL_APPS = [...WORKSPACE_APPS, ...SHELL_APPS];
/** Install PNGs that have a supplied master. Reminders stays vector-only. */
const RASTER_APPS = [...INSTALL_APPS, "sheets", "ai"];
const RASTER_SIZES = [180, 192, 512];

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
    ["magick"],
    "ImageMagick 7 is required (`magick`) to flatten install PNGs. Do not use `convert`: on Windows that name is the filesystem tool.",
  );
}

const magick = resolveMagick();

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

function imageSize(file) {
  const out = execFileSync(magick, ["identify", "-format", "%w %h", file], {
    encoding: "utf8",
  });
  const [width, height] = out.trim().split(/\s+/).map(Number);
  if (!Number.isFinite(width) || !Number.isFinite(height)) {
    throw new Error(`Could not read PNG size: ${file}`);
  }
  return { width, height };
}

function writeOpaquePng(src, size, dest) {
  const { width, height } = imageSize(src);
  const args = [src];
  // A one-pixel export sliver (e.g. 512×513) is cropped. Resampling would
  // squash the artwork. Semi-transparent fringe rows keep their stored RGB;
  // compositing them onto white shifts the tile color.
  if (width === size && height === size + 1) {
    args.push("-gravity", "north", "-crop", `${size}x${size}+0+0`, "+repage");
  } else if (height === size && width === size + 1) {
    args.push("-gravity", "west", "-crop", `${size}x${size}+0+0`, "+repage");
  } else if (width !== size || height !== size) {
    args.push("-filter", "Lanczos", "-resize", `${size}x${size}!`);
  }
  args.push("-alpha", "off", `PNG24:${dest}`);
  execFileSync(magick, args, { stdio: "inherit" });
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

  if (app === "home") {
    const installSrc = join(sourceDir, HOME_INSTALL_SOURCE);
    if (!existsSync(installSrc)) {
      console.error(`Missing home install source: ${installSrc}`);
      failed = true;
      continue;
    }
    try {
      const installMarkup = assertVectorSvg("home-pwa", installSrc);
      assertFullBleedSquare("home-pwa", installMarkup);
    } catch (err) {
      console.error(err.message);
      failed = true;
      continue;
    }
    copyFileSync(installSrc, join(uiDir, HOME_INSTALL_SOURCE));
  }

  if (RASTER_APPS.includes(app)) {
    const master = join(rasterDir, `${app}.png`);
    if (!existsSync(master)) {
      console.error(`Missing install PNG: ${master}`);
      failed = true;
      continue;
    }
    const png512 = join(pwaDir, `${app}-512.png`);
    writeOpaquePng(master, 512, png512);
    for (const size of RASTER_SIZES) {
      if (size === 512) continue;
      writeOpaquePng(png512, size, join(pwaDir, `${app}-${size}.png`));
    }
    copyFileSync(png512, join(pwaDir, `${app}-512-maskable.png`));
    writeManifestIcons(app);
  }

  for (const legacy of [`${app}.png`, `${app}-glyph.png`, `${app}-glyph.svg`]) {
    rmSync(join(uiDir, legacy), { force: true });
  }

  const install = RASTER_APPS.includes(app) ? " + install PNGs" : "";
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
