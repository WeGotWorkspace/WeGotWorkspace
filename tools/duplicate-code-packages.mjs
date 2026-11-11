/**
 * Per-package view of the duplicate-code scan (#1630). Pure functions only;
 * tools/duplicate-code-ratchet.mjs runs jscpd and calls these.
 *
 * Keys follow tools/coverage-baseline.json: `packages/apps/src/<module>`,
 * `packages/apps/src/lib/<sub>` and `packages/api/app/Services/<Domain>`.
 * Files outside those keys get the nearest folder key instead
 * (`packages/apps/src`, `packages/apps/src/lib`, `packages/api/app/Http`, ...),
 * so no scanned file drops out of the table.
 *
 * Copied lines are the lines inside at least one counted clone; clone
 * coverage is copied lines / scanned lines, in percent. The per-package
 * numbers only warn: a package "grew" when its copied lines rose, not its
 * percentage, because deleting unrelated code raises the percentage without
 * adding a copy.
 */

const reportCommand = "pnpm duplicate-code:report";

const appsRoot = "packages/apps/src";
const apiRoot = "packages/api/app";

/**
 * Package key of a scanned file, in the shape of tools/coverage-baseline.json.
 * @param {string} relPath repo-relative, `/`-separated
 * @returns {string | null} null outside both scopes
 */
export function packageKey(relPath) {
  if (relPath.startsWith(`${appsRoot}/`)) {
    const parts = relPath.slice(appsRoot.length + 1).split("/");
    if (parts.length === 1) return appsRoot;
    if (parts[0] === "lib") return parts.length === 2 ? `${appsRoot}/lib` : `${appsRoot}/lib/${parts[1]}`;
    return `${appsRoot}/${parts[0]}`;
  }
  if (relPath.startsWith(`${apiRoot}/`)) {
    const parts = relPath.slice(apiRoot.length + 1).split("/");
    if (parts.length === 1) return apiRoot;
    if (parts[0] === "Services" && parts.length > 2) return `${apiRoot}/Services/${parts[1]}`;
    return `${apiRoot}/${parts[0]}`;
  }
  return null;
}

function roundPct(value) {
  return Math.round(value * 100) / 100;
}

/**
 * Copied lines per file: the union of every clone range that touches it, so
 * a line inside two overlapping clones counts once.
 * @param {{ first: { path: string, start: number, end: number }, second: { path: string, start: number, end: number } }[]} blocks
 * @returns {Map<string, number>}
 */
export function copiedLinesPerFile(blocks) {
  /** @type {Map<string, Set<number>>} */
  const lines = new Map();
  for (const block of blocks) {
    for (const { path: file, start, end } of [block.first, block.second]) {
      const set = lines.get(file) ?? new Set();
      for (let line = start; line <= end; line += 1) set.add(line);
      lines.set(file, set);
    }
  }
  return new Map([...lines].map(([file, set]) => [file, set.size]));
}

/**
 * Clone coverage per package. Every scanned file counts toward its package's
 * line total, also when it has no clone.
 * @param {Map<string, number>} fileLines repo-relative path -> line count
 * @param {Map<string, number>} copiedLines repo-relative path -> copied lines
 * @returns {Record<string, { lines: number, duplicatedLines: number, cloneCoverage: number }>}
 */
export function packageTotals(fileLines, copiedLines) {
  /** @type {Map<string, { lines: number, duplicatedLines: number }>} */
  const buckets = new Map();
  for (const [file, lines] of fileLines) {
    const key = packageKey(file);
    if (!key || lines === 0) continue;
    const bucket = buckets.get(key) ?? { lines: 0, duplicatedLines: 0 };
    bucket.lines += lines;
    bucket.duplicatedLines += Math.min(copiedLines.get(file) ?? 0, lines);
    buckets.set(key, bucket);
  }
  return Object.fromEntries(
    [...buckets.keys()].sort().map((key) => {
      const { lines, duplicatedLines } = /** @type {{ lines: number, duplicatedLines: number }} */ (
        buckets.get(key)
      );
      return [key, { lines, duplicatedLines, cloneCoverage: roundPct((duplicatedLines / lines) * 100) }];
    }),
  );
}

/**
 * @typedef {{ cloneCoverage: number, duplicatedLines: number }} PackageEntry
 * @typedef {{ lines: number, duplicatedLines: number, cloneCoverage: number }} PackageTotals
 */

/**
 * All packages of all measured scopes in one record.
 * @param {Record<string, { packages?: Record<string, PackageTotals> }>} current
 * @returns {Record<string, PackageTotals>}
 */
export function measuredPackages(current) {
  return Object.assign({}, ...Object.values(current).map((scope) => scope.packages ?? {}));
}

/**
 * Pure per-package comparison. Never an error: the per-package numbers only
 * warn (#1630). A package grew when its copied lines rose above the baseline;
 * a package missing from the baseline counts from 0.
 * @param {Record<string, PackageTotals>} current
 * @param {Record<string, PackageEntry>} stored
 * @returns {{ rows: { key: string, current: PackageTotals | null, stored: PackageEntry | null, change: number }[], warnings: string[], dropped: number }}
 */
export function comparePackages(current, stored) {
  const keys = [...new Set([...Object.keys(current), ...Object.keys(stored)])].sort();
  const rows = keys.map((key) => {
    const now = current[key] ?? null;
    const before = stored[key] ?? null;
    return {
      key,
      current: now,
      stored: before,
      change: (now?.duplicatedLines ?? 0) - (before?.duplicatedLines ?? 0),
    };
  });
  const warnings = rows
    .filter((row) => row.change > 0)
    .map(({ key, current: now, stored: before }) => {
      const from = before
        ? `${before.duplicatedLines} (${before.cloneCoverage}%)`
        : "0 (not in the baseline)";
      return (
        `${key}: copied lines grew from ${from} to ${now?.duplicatedLines} (${now?.cloneCoverage}%). ` +
        `${reportCommand} lists the duplicated blocks.`
      );
    });
  return { rows, warnings, dropped: rows.filter((row) => row.change < 0).length };
}

/**
 * Pure package update: an entry whose copied lines did not grow takes the
 * measured values, an entry that grew keeps its baseline, and a new package
 * is added. Packages without copied lines are left out (a missing package
 * counts as 0), so the baseline lists only packages that have copies.
 * @param {Record<string, PackageTotals>} current
 * @param {Record<string, PackageEntry>} stored
 * @returns {Record<string, PackageEntry>}
 */
export function nextPackages(current, stored) {
  /** @type {Record<string, PackageEntry>} */
  const next = {};
  for (const key of Object.keys(current).sort()) {
    const now = current[key];
    const before = stored[key];
    const entry =
      before && now.duplicatedLines > before.duplicatedLines
        ? before
        : { cloneCoverage: now.cloneCoverage, duplicatedLines: now.duplicatedLines };
    if (entry.duplicatedLines > 0) next[key] = entry;
  }
  return next;
}
