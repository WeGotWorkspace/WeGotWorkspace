#!/usr/bin/env node
/**
 * Coverage ratchet per package.
 *
 * Baseline is JSON: { "packages/apps/src/<pkg>": <percentage>, "packages/api/app/Services/<Domain>": <percentage> }
 * `check` fails when any package drops more than 0.5 percentage points.
 * `update` writes current coverage to baseline.
 * Excludes mail-core and Services/Mail* (unshipped for v0.9).
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseStringPromise } from "xml2js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const baselinePath = path.join(repoRoot, "tools/coverage-baseline.json");
const appsCoveragePath = path.join(repoRoot, "packages/apps/coverage/coverage-summary.json");
const apiCoveragePath = path.join(repoRoot, "packages/api/build/logs/clover.xml");

const THRESHOLD = 0.5; // percentage points

const excluded = new Set(["mail-core", "Mail"]);

/**
 * Parse apps coverage-summary.json
 * @returns {Map<string, number>} Map of package path to line coverage percentage
 */
function parseAppsCoverage() {
  if (!existsSync(appsCoveragePath)) {
    throw new Error(`Apps coverage file not found: ${appsCoveragePath}`);
  }

  const summary = JSON.parse(readFileSync(appsCoveragePath, "utf8"));
  const coverage = new Map();

  // Aggregate by package: packages/apps/src/<pkg>
  for (const [filePath, stats] of Object.entries(summary)) {
    if (filePath === "total") continue;
    
    const match = filePath.match(/^packages\/apps\/src\/([^/]+)/);
    if (!match) continue;
    
    const pkg = match[1];
    if (excluded.has(pkg)) continue;

    const lineCoverage = stats.lines?.pct ?? 0;
    
    if (!coverage.has(pkg)) {
      coverage.set(pkg, { covered: 0, total: 0 });
    }
    
    const existing = coverage.get(pkg);
    existing.covered += stats.lines?.covered ?? 0;
    existing.total += stats.lines?.total ?? 0;
  }

  // Calculate percentages
  const result = new Map();
  for (const [pkg, { covered, total }] of coverage) {
    const pct = total > 0 ? (covered / total) * 100 : 0;
    result.set(`packages/apps/src/${pkg}`, pct);
  }

  return result;
}

/**
 * Parse API clover.xml
 * @returns {Promise<Map<string, number>>} Map of service path to line coverage percentage
 */
async function parseApiCoverage() {
  if (!existsSync(apiCoveragePath)) {
    throw new Error(`API coverage file not found: ${apiCoveragePath}`);
  }

  const xml = readFileSync(apiCoveragePath, "utf8");
  const result = await parseStringPromise(xml);
  
  const coverage = new Map();
  
  const project = result.coverage?.project?.[0];
  if (!project) return coverage;

  // Find packages/api/app/Services
  const findPackage = (pkg) => {
    const name = pkg.$.name;
    if (name.includes("app/Services")) {
      return pkg;
    }
    if (pkg.package) {
      for (const child of pkg.package) {
        const found = findPackage(child);
        if (found) return found;
      }
    }
    return null;
  };

  const servicesPackage = findPackage(project);
  if (!servicesPackage?.package) return coverage;

  // Aggregate by domain under Services/
  for (const domainPkg of servicesPackage.package) {
    const domain = domainPkg.$.name.split("/").pop();
    if (excluded.has(domain)) continue;

    const metrics = domainPkg.metrics?.[0];
    if (!metrics) continue;

    const statements = parseInt(metrics.$.statements || "0", 10);
    const coveredstatements = parseInt(metrics.$.coveredstatements || "0", 10);
    
    const pct = statements > 0 ? (coveredstatements / statements) * 100 : 0;
    coverage.set(`packages/api/app/Services/${domain}`, pct);
  }

  return coverage;
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
 * @param {Map<string, number>} coverage
 */
function writeBaseline(coverage) {
  const obj = Object.fromEntries([...coverage.entries()].sort());
  writeFileSync(baselinePath, JSON.stringify(obj, null, 2) + "\n");
}

/**
 * Check coverage against baseline
 * @param {Map<string, number>} current
 * @param {Map<string, number>} baseline
 * @returns {string[]} errors
 */
function checkCoverage(current, baseline) {
  const errors = [];

  for (const [pkg, currentPct] of current) {
    const baselinePct = baseline.get(pkg);
    if (baselinePct === undefined) {
      // New package - OK
      continue;
    }

    const drop = baselinePct - currentPct;
    if (drop > THRESHOLD) {
      errors.push(
        `${pkg}: coverage dropped from ${baselinePct.toFixed(2)}% to ${currentPct.toFixed(2)}% (${drop.toFixed(2)} points)`
      );
    }
  }

  // Check for missing packages
  for (const [pkg, baselinePct] of baseline) {
    if (!current.has(pkg)) {
      errors.push(`${pkg}: package missing from current coverage (was ${baselinePct.toFixed(2)}%)`);
    }
  }

  return errors;
}

// CLI
const command = process.argv[2];

if (command === "check") {
  console.log("Checking coverage ratchet...\n");
  
  const appsCoverage = parseAppsCoverage();
  const apiCoverage = await parseApiCoverage();
  const current = new Map([...appsCoverage, ...apiCoverage]);
  const baseline = readBaseline();

  const errors = checkCoverage(current, baseline);
  
  if (errors.length > 0) {
    console.error("❌ Coverage ratchet check failed:\n");
    for (const error of errors) {
      console.error(`  ${error}`);
    }
    console.error("\nCoverage per package can only go up. Run 'node tools/coverage-ratchet.mjs update' to lower the baseline after improving coverage.");
    process.exit(1);
  }
  
  console.log("✅ Coverage ratchet check passed");
  process.exit(0);
  
} else if (command === "update") {
  console.log("Updating coverage baseline...\n");
  
  const appsCoverage = parseAppsCoverage();
  const apiCoverage = await parseApiCoverage();
  const current = new Map([...appsCoverage, ...apiCoverage]);
  
  writeBaseline(current);
  
  console.log(`✅ Updated baseline with ${current.size} packages`);
  for (const [pkg, pct] of [...current.entries()].sort()) {
    console.log(`  ${pkg}: ${pct.toFixed(2)}%`);
  }
  process.exit(0);
  
} else {
  console.error("Usage: node tools/coverage-ratchet.mjs [check|update]");
  process.exit(1);
}
