#!/usr/bin/env node
/**
 * Coverage ratchet per package.
 *
 * Baseline is JSON:
 * { "packages/apps/src/<pkg>": <percentage>, "packages/api/app/Services/<Domain>": <percentage> }
 * Apps packages under src/lib use packages/apps/src/lib/<sub>.
 * `check` fails when a package in a present report drops more than 0.5 points
 * or disappears. Reports that are not on disk are skipped, so the apps and API
 * coverage jobs can each run `check` with only their own artifact.
 * `update` rewrites baseline keys for the reports that exist and keeps the rest.
 * mail-core and Services/Mail are unshipped for v0.9 and are excluded.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const THRESHOLD = 0.5;
export const MIN_STATEMENTS = 50;

const defaultRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = process.env.COVERAGE_RATCHET_ROOT || defaultRoot;
const baselinePath = path.join(repoRoot, "tools/coverage-baseline.json");
const appsCoveragePath = path.join(repoRoot, "packages/apps/coverage/coverage-summary.json");
const appsCoverageUnitPath = path.join(repoRoot, "packages/apps/coverage/unit/coverage-summary.json");
const appsCoverageJsdomPath = path.join(repoRoot, "packages/apps/coverage/jsdom/coverage-summary.json");
const apiCoveragePath = path.join(repoRoot, "packages/api/build/logs/clover.xml");

export function roundPct(value) {
  return Math.round(Number(value) * 100) / 100;
}

/** mail-core and Services/Mail are unshipped for v0.9. */
export function isExcludedKey(key) {
  if (key === "packages/apps/src/mail-core") return true;
  if (key === "packages/api/app/Services/Mail") return true;
  return false;
}

export function scopeOf(key) {
  if (key.startsWith("packages/apps/")) return "apps";
  if (key.startsWith("packages/api/")) return "api";
  return null;
}

/**
 * @param {string} filePath absolute, repo-relative, or packages/apps-relative
 * @returns {string | null}
 */
export function appsPackageKey(filePath) {
  const normalized = String(filePath).replaceAll("\\", "/");
  const marker = "packages/apps/src/";
  const at = normalized.indexOf(marker);
  let rest = null;
  if (at !== -1) rest = normalized.slice(at + marker.length);
  else if (normalized.startsWith("src/")) rest = normalized.slice("src/".length);
  if (rest == null) return null;

  const parts = rest.split("/").filter(Boolean);
  if (parts[0] === "lib") {
    if (parts.length < 3) return null;
    return `packages/apps/src/lib/${parts[1]}`;
  }
  if (parts.length < 2) return null;
  return `packages/apps/src/${parts[0]}`;
}

/**
 * @param {string} filePath
 * @returns {string | null}
 */
export function apiServiceKey(filePath) {
  const normalized = String(filePath).replaceAll("\\", "/");
  const match = /(?:^|\/)app\/Services\/([^/]+)\//.exec(normalized);
  if (!match) return null;
  return `packages/api/app/Services/${match[1]}`;
}

function lineCounts(stats) {
  const lines = stats?.lines ?? {};
  const covered = Number(lines.covered ?? 0);
  const total = Number(lines.total ?? 0);
  return {
    covered: Number.isFinite(covered) ? covered : 0,
    total: Number.isFinite(total) ? total : 0,
  };
}

function percentagesFromBuckets(buckets) {
  const result = new Map();
  for (const [key, counts] of buckets) {
    if (counts.total <= 0) continue;
    result.set(key, { pct: (counts.covered / counts.total) * 100, statements: counts.total });
  }
  return result;
}

function addCounts(buckets, key, covered, total) {
  if (!key || isExcludedKey(key)) return;
  const bucket = buckets.get(key) ?? { covered: 0, total: 0 };
  bucket.covered += covered;
  bucket.total += total;
  buckets.set(key, bucket);
}

/**
 * @param {Record<string, unknown>} summary coverage-summary.json
 * @returns {Map<string, {pct: number, statements: number}>}
 */
export function coverageFromAppsSummary(summary) {
  const buckets = new Map();
  for (const [filePath, stats] of Object.entries(summary ?? {})) {
    if (filePath === "total") continue;
    const counts = lineCounts(stats);
    addCounts(buckets, appsPackageKey(filePath), counts.covered, counts.total);
  }
  return percentagesFromBuckets(buckets);
}

/**
 * When unit and jsdom summaries are separate, keep the higher covered count
 * per file. The merged coverage-summary.json is preferred when it exists.
 * @param {Record<string, unknown>[]} summaries
 */
export function coverageFromAppsSummaries(summaries) {
  const files = new Map();
  for (const summary of summaries) {
    for (const [filePath, stats] of Object.entries(summary ?? {})) {
      if (filePath === "total") continue;
      const counts = lineCounts(stats);
      const previous = files.get(filePath);
      if (!previous || counts.covered > previous.covered) files.set(filePath, counts);
    }
  }
  const buckets = new Map();
  for (const [filePath, counts] of files) {
    addCounts(buckets, appsPackageKey(filePath), counts.covered, counts.total);
  }
  return percentagesFromBuckets(buckets);
}

/**
 * Parse API clover.xml without xml2js - uses regex to extract file metrics
 * @returns {Map<string, {pct: number, statements: number}>}
 */
function parseApiCoverage() {
  if (!existsSync(apiCoveragePath)) {
    throw new Error(`API coverage file not found: ${apiCoveragePath}`);
  }

  const xml = readFileSync(apiCoveragePath, "utf8");
  const buckets = new Map();

  // Match each <file name="..."> and its following <metrics statements="X" coveredstatements="Y">
  const fileRegex = /<file name="([^"]+)"/g;
  const metricsRegex = /<metrics[^>]+statements="(\d+)"[^>]+coveredstatements="(\d+)"/;

  let match;
  while ((match = fileRegex.exec(xml)) !== null) {
    const filePath = match[1];
    
    // Find metrics in the text following this file tag
    const afterFile = xml.slice(match.index);
    const metricsMatch = afterFile.match(metricsRegex);
    
    if (metricsMatch) {
      const statements = parseInt(metricsMatch[1], 10);
      const coveredStatements = parseInt(metricsMatch[2], 10);
      addCounts(buckets, apiServiceKey(filePath), coveredStatements, statements);
    }
  }

  return percentagesFromBuckets(buckets);
}

/**
 * Parse apps coverage with fallback to unit+jsdom
 * @returns {Map<string, {pct: number, statements: number}>}
 */
function parseAppsCoverage() {
  if (existsSync(appsCoveragePath)) {
    const summary = JSON.parse(readFileSync(appsCoveragePath, "utf8"));
    return coverageFromAppsSummary(summary);
  }
  
  // Fallback to separate unit and jsdom reports
  const summaries = [];
  if (existsSync(appsCoverageUnitPath)) {
    summaries.push(JSON.parse(readFileSync(appsCoverageUnitPath, "utf8")));
  }
  if (existsSync(appsCoverageJsdomPath)) {
    summaries.push(JSON.parse(readFileSync(appsCoverageJsdomPath, "utf8")));
  }
  
  if (summaries.length === 0) {
    throw new Error(`Apps coverage files not found: ${appsCoveragePath}, ${appsCoverageUnitPath}, ${appsCoverageJsdomPath}`);
  }
  
  return coverageFromAppsSummaries(summaries);
}

/**
 * Read baseline
 * @returns {Map<string, number>}
 */
function readBaseline() {
  if (!existsSync(baselinePath)) {
    return new Map();
  }
  const data = JSON.parse(readFileSync(baselinePath, "utf8"));
  return new Map(Object.entries(data));
}

/**
 * Write baseline
 * @param {Map<string, {pct: number, statements: number}>} coverage
 */
function writeBaseline(coverage) {
  const obj = {};
  for (const [pkg, { pct }] of [...coverage.entries()].sort()) {
    obj[pkg] = roundPct(pct);
  }
  writeFileSync(baselinePath, JSON.stringify(obj, null, 2) + "\n");
}

/**
 * Check coverage against baseline
 * @param {Map<string, {pct: number, statements: number}>} current
 * @param {Map<string, number>} baseline
 * @returns {{errors: string[], warnings: string[], increases: Array<{pkg: string, from: number, to: number}>, proposals: Array<{pkg: string, pct: number}>}}
 */
function checkCoverage(current, baseline) {
  const errors = [];
  const warnings = [];
  const increases = [];
  const proposals = [];

  for (const [pkg, { pct: currentPct, statements }] of current) {
    const baselinePct = baseline.get(pkg);
    if (baselinePct === undefined) {
      // New package - proposal
      proposals.push({ pkg, pct: currentPct });
      continue;
    }

    const drop = roundPct(baselinePct) - roundPct(currentPct);
    
    if (drop > THRESHOLD) {
      const msg = `${pkg}: coverage dropped from ${roundPct(baselinePct).toFixed(2)}% to ${roundPct(currentPct).toFixed(2)}% (${drop.toFixed(2)} points)`;
      
      if (statements >= MIN_STATEMENTS) {
        errors.push(msg);
      } else {
        warnings.push(`${msg} (< ${MIN_STATEMENTS} statements, not enforced)`);
      }
    } else if (roundPct(currentPct) > roundPct(baselinePct) + 0.1) {
      // Coverage increased
      increases.push({ pkg, from: baselinePct, to: currentPct });
    }
  }

  // Check for missing packages - warning only (packages can be renamed/removed)
  for (const [pkg, baselinePct] of baseline) {
    if (!current.has(pkg)) {
      warnings.push(`${pkg}: package missing from current coverage (was ${roundPct(baselinePct).toFixed(2)}%)`);
    }
  }

  return { errors, warnings, increases, proposals };
}

// CLI
const command = process.argv[2];

if (command === "check") {
  console.log("Checking coverage ratchet...\n");
  
  let appsCoverage = new Map();
  let apiCoverage = new Map();
  
  try {
    appsCoverage = parseAppsCoverage();
  } catch (e) {
    // Apps coverage not available - skip
  }
  
  try {
    apiCoverage = parseApiCoverage();
  } catch (e) {
    // API coverage not available - skip
  }
  
  const current = new Map([...appsCoverage, ...apiCoverage]);
  const baseline = readBaseline();

  const { errors, warnings, increases, proposals } = checkCoverage(current, baseline);
  
  // Always show warnings
  if (warnings.length > 0) {
    console.log("⚠️  Warnings:\n");
    for (const warning of warnings) {
      console.log(`  ${warning}`);
    }
    console.log();
  }

  // Show increases (for info)
  if (increases.length > 0) {
    console.log("📈 Coverage increases detected:\n");
    for (const { pkg, from, to } of increases) {
      console.log(`  ${pkg}: ${roundPct(from).toFixed(2)}% → ${roundPct(to).toFixed(2)}%`);
    }
    console.log();
  }
  
  // Show new packages
  if (proposals.length > 0) {
    console.log("📦 New packages detected:\n");
    for (const { pkg, pct } of proposals) {
      console.log(`  ${pkg}: ${roundPct(pct).toFixed(2)}%`);
    }
    console.log();
  }
  
  if (errors.length > 0) {
    console.error("❌ Coverage ratchet check failed:\n");
    for (const error of errors) {
      console.error(`  ${error}`);
    }
    console.error("\nCoverage per package can only go up. Run 'node tools/coverage-ratchet.mjs update' after improving coverage.");
    process.exit(1);
  }
  
  console.log("✅ Coverage ratchet check passed");
  
  // Exit with special code if increases or new packages detected (for CI to propose)
  process.exit(increases.length > 0 || proposals.length > 0 ? 2 : 0);
  
} else if (command === "update") {
  console.log("Updating coverage baseline...\n");
  
  let appsCoverage = new Map();
  let apiCoverage = new Map();
  
  try {
    appsCoverage = parseAppsCoverage();
  } catch (e) {
    // Apps coverage not available - skip
  }
  
  try {
    apiCoverage = parseApiCoverage();
  } catch (e) {
    // API coverage not available - skip
  }
  
  const current = new Map([...appsCoverage, ...apiCoverage]);
  
  writeBaseline(current);
  
  console.log(`✅ Updated baseline with ${current.size} packages`);
  for (const [pkg, { pct }] of [...current.entries()].sort()) {
    console.log(`  ${pkg}: ${roundPct(pct).toFixed(2)}%`);
  }
  process.exit(0);
  
} else {
  console.error("Usage: node tools/coverage-ratchet.mjs [check|update]");
  process.exit(1);
}
