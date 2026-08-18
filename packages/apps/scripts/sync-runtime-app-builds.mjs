#!/usr/bin/env node

import {
  cpSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(__dirname, "..");
const repoRoot = resolve(packageRoot, "..", "..");
const distRoot = resolve(packageRoot, "dist");
const assetsDir = resolve(distRoot, "assets");
const runtimeAppsRoot = resolve(repoRoot, "apps", "wegotworkspace", "packages", "apps");
const installRoot = resolve(repoRoot, "apps", "wegotworkspace");

const modules = [
  { name: "shell", title: "WeGotWorkspace" },
  { name: "admin", title: "Admin Console - WeGotWorkspace" },
  { name: "drive", title: "Drive - WeGotWorkspace" },
  { name: "install", title: "WeGotWorkspace Installer" },
  { name: "mail", title: "Mail - WeGotWorkspace" },
  { name: "contacts", title: "Contacts - WeGotWorkspace" },
  { name: "tasks", title: "Tasks - WeGotWorkspace" },
  { name: "calendar", title: "Calendar - WeGotWorkspace" },
  { name: "notes", title: "Notes - WeGotWorkspace" },
  { name: "settings", title: "Settings - WeGotWorkspace" },
  { name: "meet", title: "Meet - WeGotWorkspace" },
];

const RUNTIME_FONT_PRELOADS = [
  "GeneralSans-Variable.woff2",
  "GeneralSans-VariableItalic.woff2",
  "LibreCaslonCondensed.woff2",
  "JetBrainsMono-Variable.woff2",
];

/** Workbox service worker artifacts generated beside dist/index.html (hashed workbox-*.js name). */
function listPwaServiceWorkerFiles(distRoot) {
  return readdirSync(distRoot).filter(
    (file) => file === "sw.js" || (file.startsWith("workbox-") && file.endsWith(".js")),
  );
}

function renderFontPreloadTags(assetBase) {
  return RUNTIME_FONT_PRELOADS.map(
    (file) =>
      `    <link rel="preload" href="${assetBase}/fonts/${file}" as="font" type="font/woff2" crossorigin>`,
  ).join("\n");
}

function renderIndexHtml({ title, scriptPath, cssPath, assetBase = "" }) {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${title}</title>
${renderFontPreloadTags(assetBase)}
    <script type="module" crossorigin src="${scriptPath}"></script>
    <link rel="stylesheet" crossorigin href="${cssPath}">
  </head>
  <body>
    <div id="root"></div>
  </body>
</html>
`;
}

export function syncRuntimeAppBuilds() {
  const files = readdirSync(assetsDir);
  const mainJs = pickLargestFile(files, /^index-.*\.js$/);
  const mainCss =
    pickLargestFile(files, /^index-.*\.css$/) ?? pickLargestFile(files, /^styles-.*\.css$/);

  if (!mainJs || !mainCss) {
    throw new Error(
      `Could not determine main app entry files in ${assetsDir}. Found js=${String(mainJs)}, css=${String(mainCss)}`,
    );
  }

  const pwaServiceWorkerFiles = listPwaServiceWorkerFiles(distRoot);

  for (const module of modules) {
    const targetDist = resolve(runtimeAppsRoot, module.name, "dist");
    const targetAssetsDir = resolve(targetDist, "assets");

    mkdirSync(targetDist, { recursive: true });
    rmSync(targetAssetsDir, { recursive: true, force: true });
    rmSync(resolve(targetDist, "fonts"), { recursive: true, force: true });
    rmSync(resolve(targetDist, "app-icons"), { recursive: true, force: true });
    rmSync(resolve(targetDist, "pwa-icons"), { recursive: true, force: true });
    rmSync(resolve(targetDist, "manifests"), { recursive: true, force: true });

    cpSync(assetsDir, targetAssetsDir, { recursive: true });
    cpSync(resolve(distRoot, "fonts"), resolve(targetDist, "fonts"), { recursive: true });
    cpSync(resolve(distRoot, "app-icons"), resolve(targetDist, "app-icons"), { recursive: true });
    cpSync(resolve(distRoot, "pwa-icons"), resolve(targetDist, "pwa-icons"), { recursive: true });
    cpSync(resolve(distRoot, "manifests"), resolve(targetDist, "manifests"), { recursive: true });

    for (const file of pwaServiceWorkerFiles) {
      cpSync(resolve(distRoot, file), resolve(targetDist, file));
    }

    for (const file of readdirSync(targetAssetsDir)) {
      const filePath = resolve(targetAssetsDir, file);
      if (file.endsWith(".js")) {
        patchRelativeAssetPaths(filePath);
      }
      if (file.endsWith(".css")) {
        patchStaticRuntimeStylesheet(filePath);
      }
    }

    // Shell and product apps are served from site-root SPA paths; absolute /assets/* avoids broken
    // relative URLs when index.html is returned for deep links like /contacts/all/:contactId.
    const assetBase = module.name === "install" ? "/install" : "";
    const html = renderIndexHtml({
      title: module.title,
      scriptPath: `${assetBase}/assets/${mainJs}`,
      cssPath: `${assetBase}/assets/${mainCss}`,
      assetBase,
    });
    writeFileSync(resolve(targetDist, "index.html"), html, "utf8");
  }

  // Apache serves existing docroot files directly; copy PWA root assets beside index.php
  // so /index.html and /sw.js work even when the install-tree packages/api copy is stale.
  cpSync(
    resolve(runtimeAppsRoot, "shell", "dist", "index.html"),
    resolve(installRoot, "index.html"),
  );
  for (const file of pwaServiceWorkerFiles) {
    cpSync(resolve(distRoot, file), resolve(installRoot, file));
  }

  console.log(
    `Synced frontend runtime app builds (${modules.map((m) => m.name).join(", ")}) using ${mainJs} and ${mainCss}.`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  syncRuntimeAppBuilds();
}

function pickLargestFile(allFiles, pattern) {
  const matches = allFiles.filter((file) => pattern.test(file));
  if (matches.length === 0) return null;
  return matches
    .map((file) => ({ file, size: statSync(resolve(assetsDir, file)).size }))
    .sort((a, b) => b.size - a.size)[0]?.file;
}

function patchRelativeAssetPaths(filePath) {
  const source = readFileSync(filePath, "utf8");
  const patched = source
    .replace(/(["'])\/assets\//g, "$1./assets/")
    .replace(/(["'])assets\//g, "$1./assets/")
    .replace(/\/assets\//g, "./assets/");
  if (patched !== source) {
    writeFileSync(filePath, patched, "utf8");
  }
}

function patchStaticRuntimeStylesheet(filePath) {
  const source = readFileSync(filePath, "utf8");
  const withRelativeAssetLinks = source
    .replace(/url\((['"]?)\/fonts\//g, "url($1../fonts/")
    .replace(/url\((['"]?)\/app-icons\//g, "url($1../app-icons/")
    .replace(/url\((['"]?)\/pwa-icons\//g, "url($1../pwa-icons/")
    .replace(/url\((['"]?)\/manifests\//g, "url($1../manifests/")
    .replace(/url\((['"]?)\/assets\//g, "url($1./assets/");
  if (withRelativeAssetLinks !== source) {
    writeFileSync(filePath, withRelativeAssetLinks, "utf8");
  }
}
