#!/usr/bin/env node
/**
 * Fails when demo data from the mock modules ends up in the production app
 * bundle (#1628). Run after `pnpm --filter @wgw/apps run build`.
 *
 * Each marker is a string literal that only its mock module writes. The check
 * also confirms the marker is still in that module, so renaming the fixture
 * cannot silently turn the check into a no-op.
 *
 * Usage: node tools/check-dist-mock-markers.mjs [packages/apps/dist]
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const appsSrc = path.join(repoRoot, "packages/apps/src");

/** `source` is relative to `packages/apps/src`. */
export const MOCK_MARKERS = [
  { marker: "Carol Example", source: "lib/api/mock/admin-bootstrap.ts" },
  {
    marker: "Search reindex cancelled by user.",
    source: "admin-core/src/admin-mock-operations.ts",
  },
  { marker: "ada@example.test", source: "lib/api/mock/calendar-bootstrap.ts" },
  {
    marker: "2033-01-12T08:00:00Z",
    source: "lib/api/mock/calendar-ics-operations.ts",
  },
  { marker: "Acme Corp", source: "lib/api/mock/contacts-bootstrap.ts" },
  { marker: "/users/demo/readme.md", source: "lib/api/mock/docs-bootstrap.ts" },
  { marker: "Alice Chen", source: "lib/api/mock/drive-share-fixtures.ts" },
  { marker: "Shared Notes.md", source: "lib/api/mock/drive-share-mock.ts" },
  {
    marker: "/var/www/wgw-content",
    source: "lib/api/mock/installer-bootstrap.ts",
  },
  { marker: "Alan Turing", source: "lib/api/mock/meet-chat-fixtures.ts" },
  { marker: "Bindery Workshop", source: "lib/api/mock/settings-bootstrap.ts" },
  { marker: "Default inbox task", source: "lib/api/mock/tasks-bootstrap.ts" },
];

/** Markers whose source module no longer contains them (the list needs an update). */
export function staleMarkers(markers, srcRoot = appsSrc) {
  return markers.filter(({ marker, source }) => {
    const file = path.join(srcRoot, source);
    return !existsSync(file) || !readFileSync(file, "utf8").includes(marker);
  });
}

/** `{ marker, source, file }` for every marker found in a `dist/assets/*.js` file. */
export function findMarkersInDist(distDir, markers) {
  const assetsDir = path.join(distDir, "assets");
  if (!existsSync(assetsDir)) {
    throw new Error(
      `No ${assetsDir}. Run \`pnpm --filter @wgw/apps run build\` first.`,
    );
  }
  const hits = [];
  for (const name of readdirSync(assetsDir)
    .filter((n) => n.endsWith(".js"))
    .sort()) {
    const text = readFileSync(path.join(assetsDir, name), "utf8");
    for (const entry of markers) {
      if (text.includes(entry.marker))
        hits.push({ ...entry, file: `assets/${name}` });
    }
  }
  return hits;
}

function main() {
  const distDir = path.resolve(
    process.argv[2] ?? path.join(repoRoot, "packages/apps/dist"),
  );
  const stale = staleMarkers(MOCK_MARKERS);
  if (stale.length > 0) {
    console.error(
      "Mock markers no longer found in their source module (update MOCK_MARKERS):",
    );
    for (const { marker, source } of stale)
      console.error(`  - ${JSON.stringify(marker)} in ${source}`);
    process.exit(1);
  }
  const hits = findMarkersInDist(distDir, MOCK_MARKERS);
  if (hits.length > 0) {
    console.error(
      "Demo data from the mock modules is in the production bundle:",
    );
    for (const { marker, source, file } of hits) {
      console.error(`  - ${file}: ${JSON.stringify(marker)} (from ${source})`);
    }
    console.error(
      "Gate the mock factory on `mocksInBuild` (lib/api/create-workspace-source.ts) so the build drops it.",
    );
    process.exit(1);
  }
  console.log(
    `No mock data in ${path.relative(repoRoot, distDir) || distDir} (${MOCK_MARKERS.length} markers).`,
  );
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  main();
