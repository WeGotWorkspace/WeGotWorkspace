#!/usr/bin/env node

import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const appsRoot = resolve(__dirname, "..");
const srcRoot = join(appsRoot, "src");
const baselinePath = join(__dirname, "storybook-coverage-baseline.json");

const EXCLUDE_EXPORT_SUFFIXES = [
  "Props",
  "State",
  "Schema",
  "Values",
  "Options",
  "Types",
  "Controller",
  "Config",
  "Source",
  "Operations",
  "ApiSource",
  "FormController",
];
const EXCLUDE_EXPORT_NAMES = new Set([
  "DOCS_EDITOR_EXTENSIONS",
  "NOOP_MAIL_API_OPERATIONS",
  "MultiSelectionView",
  "WegotworkspaceRouter",
  "WegotworkspaceRouterShared",
  "WegotworkspaceRoutes",
  "WegotworkspaceRequireAuth",
  "WegotworkspaceLogout",
  "WegotworkspaceLoginRoute",
  "WegotworkspaceShell",
  "WegotworkspaceLive",
  "WegotworkspaceLiveHome",
  "WegotworkspaceHome",
]);

/** @param {string} name */
function isCatalogExport(name) {
  if (!/^[A-Z][A-Za-z0-9]*$/.test(name)) {
    return false;
  }
  if (name.startsWith("use")) {
    return false;
  }
  if (EXCLUDE_EXPORT_NAMES.has(name)) {
    return false;
  }
  return !EXCLUDE_EXPORT_SUFFIXES.some((suffix) => name.endsWith(suffix));
}

/** @param {string} dir */
function walkFiles(dir, predicate, results = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      if (entry === "node_modules" || entry === "dist") {
        continue;
      }
      walkFiles(full, predicate, results);
    } else if (predicate(full)) {
      results.push(full);
    }
  }
  return results;
}

/** @param {string} filePath */
function parseIndexExports(filePath) {
  const content = readFileSync(filePath, "utf8");
  const exports = [];
  const exportBlock = /export\s*\{([^}]+)\}/g;
  for (const match of content.matchAll(exportBlock)) {
    for (const part of match[1].split(",")) {
      const trimmed = part.trim();
      if (!trimmed || trimmed.startsWith("type ")) {
        continue;
      }
      const name = trimmed.split(/\s+as\s+/)[0].trim();
      if (isCatalogExport(name)) {
        exports.push(name);
      }
    }
  }
  return exports;
}

/** @param {string} componentName */
function componentSlug(componentName) {
  return componentName
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/([A-Z])([A-Z][a-z])/g, "$1-$2")
    .toLowerCase();
}

/** @returns {Map<string, { id: string, component: string, module: string }>} */
function discoverSurfaces() {
  /** @type {Map<string, { id: string, component: string, module: string }>} */
  const surfaces = new Map();

  for (const indexPath of walkFiles(srcRoot, (file) => basename(file) === "index.ts")) {
    const moduleDir = relative(srcRoot, dirname(indexPath));
    // src/lib/** is non-UI infrastructure (api clients, offline stores, the
    // vendored calendar engine/jmap client) — classes exported there are not
    // catalog surfaces. UI files under lib would still be caught by the
    // *-app/*-workspace/*-pane walk below.
    if (moduleDir === "lib" || moduleDir.startsWith("lib/")) {
      continue;
    }
    for (const component of parseIndexExports(indexPath)) {
      const id = `${moduleDir}::${component}`;
      surfaces.set(id, { id, component, module: moduleDir });
    }
  }

  for (const filePath of walkFiles(
    srcRoot,
    (file) =>
      /-(app|workspace|pane)\.tsx$/.test(file) &&
      !file.includes("/stories/") &&
      !file.endsWith(".test.tsx"),
  )) {
    const component = basename(filePath, ".tsx");
    const componentName = component
      .split("-")
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join("");
    const moduleDir = relative(srcRoot, dirname(filePath));
    const id = `${moduleDir}::${componentName}`;
    if (!surfaces.has(id)) {
      surfaces.set(id, { id, component: componentName, module: moduleDir });
    }
  }

  for (const dir of readdirSync(srcRoot)) {
    const full = join(srcRoot, dir);
    if (!statSync(full).isDirectory()) {
      continue;
    }
    if (dir.endsWith("-core") || dir === "lib" || dir === "ui") {
      continue;
    }
    const storiesDir = join(full, "stories");
    try {
      if (!statSync(storiesDir).isDirectory()) {
        continue;
      }
    } catch {
      continue;
    }
    const primaryTsx = walkFiles(full, (file) => {
      if (!file.endsWith(".tsx") || file.endsWith(".test.tsx")) {
        return false;
      }
      if (file.includes("/stories/")) {
        return false;
      }
      return basename(file, ".tsx") === dir || basename(dirname(file)) === "src";
    });
    for (const filePath of primaryTsx) {
      const base = basename(filePath, ".tsx");
      const componentName = base
        .split("-")
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join("");
      const moduleDir = relative(srcRoot, dirname(filePath));
      const id = `${moduleDir}::${componentName}`;
      if (!surfaces.has(id)) {
        surfaces.set(id, { id, component: componentName, module: moduleDir });
      }
    }
  }

  return surfaces;
}

/** @returns {{ content: string, paths: string[] }} */
function loadStoryFiles() {
  const paths = walkFiles(srcRoot, (file) => file.endsWith(".stories.tsx"));
  const content = paths.map((path) => readFileSync(path, "utf8")).join("\n");
  return { content, paths };
}

/**
 * @param {{ component: string, module: string }} surface
 * @param {string} storiesBlob
 * @param {string[]} storyPaths
 */
function isSurfaceCovered(surface, storiesBlob, storyPaths) {
  const slug = componentSlug(surface.component);

  if (storiesBlob.includes(surface.component)) {
    return true;
  }

  const modulePrefix = surface.module.split("/")[0];
  return storyPaths.some((storyPath) => {
    const rel = relative(srcRoot, storyPath).replace(/\\/g, "/");
    if (!rel.includes("/stories/")) {
      return false;
    }
    if (!rel.startsWith(`${modulePrefix}/`)) {
      return false;
    }
    return rel.includes(slug);
  });
}

/** @param {string[]} missing */
function loadBaseline() {
  try {
    const raw = readFileSync(baselinePath, "utf8");
    const data = JSON.parse(raw);
    if (!Array.isArray(data.allowedMissing)) {
      throw new Error("baseline must contain allowedMissing array");
    }
    return data.allowedMissing.slice().sort();
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

function main() {
  const updateBaseline = process.argv.includes("--update-baseline");
  const surfaces = discoverSurfaces();
  const { content: storiesBlob, paths: storyPaths } = loadStoryFiles();

  /** @type {string[]} */
  const missing = [];
  for (const surface of surfaces.values()) {
    if (!isSurfaceCovered(surface, storiesBlob, storyPaths)) {
      missing.push(surface.id);
    }
  }
  missing.sort();

  const coveredCount = surfaces.size - missing.length;
  console.log(
    `Storybook catalog coverage: ${coveredCount}/${surfaces.size} surfaces (${missing.length} missing)`,
  );

  if (updateBaseline) {
    writeFileSync(
      baselinePath,
      `${JSON.stringify({ allowedMissing: missing }, null, 2)}\n`,
      "utf8",
    );
    console.log(`Updated baseline: ${relative(appsRoot, baselinePath)}`);
    return;
  }

  const baseline = loadBaseline();
  const baselineSet = new Set(baseline);
  const missingSet = new Set(missing);

  const newGaps = missing.filter((id) => !baselineSet.has(id));
  const resolved = baseline.filter((id) => !missingSet.has(id));

  if (newGaps.length > 0) {
    console.error("\nNew catalog surfaces without mock-tier Storybook coverage:");
    for (const id of newGaps) {
      console.error(`  - ${id}`);
    }
  }

  if (resolved.length > 0) {
    console.error("\nBaseline entries now covered — run with --update-baseline:");
    for (const id of resolved) {
      console.error(`  - ${id}`);
    }
  }

  if (newGaps.length > 0 || resolved.length > 0) {
    process.exit(1);
  }

  if (missing.length > 0) {
    console.log(`${missing.length} known gap(s) tracked in baseline (OK until stories land).`);
  } else {
    console.log("Full catalog coverage — no baseline gaps.");
  }
}

main();
