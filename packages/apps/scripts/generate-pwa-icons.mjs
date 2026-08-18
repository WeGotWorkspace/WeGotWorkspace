#!/usr/bin/env node
/**
 * Publish vector app icons for UI/manifests and rasterize iOS apple-touch icons.
 *
 * Canonical source: `src/assets/app-icons/{app}.svg` — real vector SVG only.
 * Rejects SVG files that embed raster data (`<image`, `data:image`, `base64`).
 *
 * Output:
 *   - `public/app-icons/{app}.svg` — copied verbatim for UI + web app manifests
 *   - `public/pwa-icons/{app}-180.png` — rasterized 180×180 for iOS apple-touch-icon only
 *
 * Web app manifests reference the SVG directly. PNG rasterization is limited to the one size
 * iOS Safari still requires via `<link rel="apple-touch-icon">` (no SVG support there).
 *
 * When icon artwork changes, bump `WORKSPACE_PWA_ICON_CACHE_VERSION` in
 * `src/lib/workspace-pwa-head.ts` and regenerate manifest `?v=` query strings (or re-run this script
 * once manifest emission is wired here).
 *
 * Switch-trigger inversion uses the same SVG with `--wai-*` CSS vars (see workspace-app-icon.css).
 *
 * Requires ImageMagick (`magick`) for apple-touch PNG generation.
 */
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const packageDir = join(__dirname, "..");
const publicDir = join(packageDir, "public");
const sourceDir = join(packageDir, "src", "assets", "app-icons");
const uiDir = join(publicDir, "app-icons");
const pwaDir = join(publicDir, "pwa-icons");

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
/** Shell / suite PWA manifest (home.webmanifest) — vector only, no workspace grid tile. */
const SHELL_APPS = ["home"];
const ALL_APPS = [...WORKSPACE_APPS, ...FUTURE_APPS, ...SHELL_APPS];
const APPLE_TOUCH_APPS = [...WORKSPACE_APPS, ...SHELL_APPS];
const APPLE_TOUCH_SIZE = 180;

const RASTER_EMBED_RE =
  /<image\b|data:image|xlink:href\s*=\s*["']data:|href\s*=\s*["']data:image|base64/i;

mkdirSync(sourceDir, { recursive: true });
mkdirSync(uiDir, { recursive: true });
mkdirSync(pwaDir, { recursive: true });

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

/** ImageMagick does not resolve CSS custom properties — inline var() fallbacks for apple-touch PNGs. */
function svgForRasterization(markup) {
  return markup.replace(/var\(\s*--[\w-]+\s*,\s*([^)]+?)\s*\)/g, "$1");
}

let failed = false;

for (const app of ALL_APPS) {
  const srcSvg = join(sourceDir, `${app}.svg`);
  if (!existsSync(srcSvg)) {
    console.error(`Missing vector source: ${srcSvg}`);
    failed = true;
    continue;
  }

  try {
    assertVectorSvg(app, srcSvg);
  } catch (err) {
    console.error(err.message);
    failed = true;
    continue;
  }

  const destSvg = join(uiDir, `${app}.svg`);
  copyFileSync(srcSvg, destSvg);

  if (APPLE_TOUCH_APPS.includes(app)) {
    const dest = join(pwaDir, `${app}-${APPLE_TOUCH_SIZE}.png`);
    const rasterSvg = join(pwaDir, `.${app}-raster.svg`);
    writeFileSync(rasterSvg, svgForRasterization(readFileSync(destSvg, "utf8")));
    execFileSync(
      "magick",
      [
        rasterSvg,
        "-filter",
        "Lanczos",
        "-resize",
        `${APPLE_TOUCH_SIZE}x${APPLE_TOUCH_SIZE}!`,
        dest,
      ],
      { stdio: "inherit" },
    );
    rmSync(rasterSvg, { force: true });
    for (const legacySize of [192, 512]) {
      rmSync(join(pwaDir, `${app}-${legacySize}.png`), { force: true });
    }
  }

  for (const legacy of [`${app}.png`, `${app}-glyph.png`, `${app}-glyph.svg`]) {
    rmSync(join(uiDir, legacy), { force: true });
  }
  for (const legacySize of [192, 512]) {
    rmSync(join(pwaDir, `${app}-${legacySize}.png`), { force: true });
  }

  const appleTouch = APPLE_TOUCH_APPS.includes(app) ? " + apple-touch PNG" : "";
  console.log(`Published vector icon${appleTouch} for ${app}`);
}

if (failed) {
  process.exit(1);
}
