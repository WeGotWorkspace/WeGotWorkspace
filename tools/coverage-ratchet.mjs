#!/usr/bin/env node
/**
 * Coverage ratchet per package.
 *
 * Baseline is JSON: { "packages/apps/src/<pkg>": <percentage>, "packages/api/app/Services/<Domain>": <percentage> }
 * `check` fails when any package drops more than 0.5 percentage points (for packages >= 50 statements).
 * `update` writes current coverage to baseline.
 * Excludes mail-core and Services/Mail* (unshipped for v0.9).
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const baselinePath = path.join(repoRoot, "tools/coverage-baseline.json");
const appsCoveragePath = path.join(repoRoot, "packages/apps/coverage/coverage-summary.json");
const apiCoveragePath = path.join(repoRoot, "packages/api/build/logs/clover.xml");

const THRESHOLD = 0.5; // percentage points
const MIN_STATEMENTS = 50; // only enforce threshold for packages with >= 50 statements

const excluded = new Set(["mail-core", "Mail"]);

/**
 * Parse apps coverage-summary.json
 * @returns {Map<string, {pct: number, statements: number}>}
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
    result.set(`packages/apps/src/${pkg}`, { pct, statements: total });
  }

  return result;
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
  const coverage = new Map();

  // Match each <file name="..."> and its following <metrics statements="X" coveredstatements="Y">
  const fileRegex = /<file name="([^"]+)"/g;
  const metricsRegex = /<metrics[^>]+statements="(\d+)"[^>]+coveredstatements="(\d+)"/;

  let match;
  while ((match = fileRegex.exec(xml)) !== null) {
    const filePath = match[1];
    
    // Only process files under app/Services/
    const serviceMatch = filePath.match(/app\/Services\/([^/]+)\//);
    if (!serviceMatch) continue;
    
    const domain = serviceMatch[1];
    if (excluded.has(domain)) continue;

    // Find metrics in the text following this file tag
    const afterFile = xml.slice(match.index);
    const metricsMatch = afterFile.match(metricsRegex);
    
    if (metricsMatch) {
      const statements = parseInt(metricsMatch[1], 10);
      const coveredStatements = parseInt(metricsMatch[2], 10);
      
      const pkgKey = `packages/api/app/Services/${domain}`;
      if (!coverage.has(pkgKey)) {
        coverage.set(pkgKey, { statements: 0, covered: 0 });
      }
      
      const existing = coverage.get(pkgKey);
      existing.statements += statements;
      existing.covered += coveredStatements;
    }
  }

  // Calculate percentages
  const result = new Map();
  for (const [pkg, { statements, covered }] of coverage) {
    const pct = statements > 0 ? (covered / statements) * 100 : 0;
    result.set(pkg, { pct, statements });
  }

  return result;
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
    obj[pkg] = pct;
  }
  writeFileSync(baselinePath, JSON.stringify(obj, null, 2) + "\n");
}

/**
 * Check coverage against baseline
 * @param {Map<string, {pct: number, statements: number}>} current
 * @param {Map<string, number>} baseline
 * @returns {{errors: string[], warnings: string[], increases: Array<{pkg: string, from: number, to: number}>}}
 */
function checkCoverage(current, baseline) {
  const errors = [];
  const warnings = [];
  const increases = [];

  for (const [pkg, { pct: currentPct, statements }] of current) {
    const baselinePct = baseline.get(pkg);
    if (baselinePct === undefined) {
      // New package - OK, no baseline yet
      continue;
    }

    const drop = baselinePct - currentPct;
    
    if (drop > THRESHOLD) {
      const msg = `${pkg}: coverage dropped from ${baselinePct.toFixed(2)}% to ${currentPct.toFixed(2)}% (${drop.toFixed(2)} points)`;
      
      if (statements >= MIN_STATEMENTS) {
        errors.push(msg);
      } else {
        warnings.push(`${msg} (< ${MIN_STATEMENTS} statements, not enforced)`);
      }
    } else if (currentPct > baselinePct + 0.1) {
      // Coverage increased
      increases.push({ pkg, from: baselinePct, to: currentPct });
    }
  }

  // Check for missing packages - warning only (packages can be renamed/removed)
  for (const [pkg, baselinePct] of baseline) {
    if (!current.has(pkg)) {
      warnings.push(`${pkg}: package missing from current coverage (was ${baselinePct.toFixed(2)}%)`);
    }
  }

  return { errors, warnings, increases };
}

// CLI
const command = process.argv[2];

if (command === "check") {
  console.log("Checking coverage ratchet...\n");
  
  const appsCoverage = parseAppsCoverage();
  const apiCoverage = parseApiCoverage();
  const current = new Map([...appsCoverage, ...apiCoverage]);
  const baseline = readBaseline();

  const { errors, warnings, increases } = checkCoverage(current, baseline);
  
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
      console.log(`  ${pkg}: ${from.toFixed(2)}% → ${to.toFixed(2)}%`);
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
  
  // Exit with special code if increases detected (for CI to open PR)
  process.exit(increases.length > 0 ? 2 : 0);
  
} else if (command === "update") {
  console.log("Updating coverage baseline...\n");
  
  const appsCoverage = parseAppsCoverage();
  const apiCoverage = parseApiCoverage();
  const current = new Map([...appsCoverage, ...apiCoverage]);
  
  writeBaseline(current);
  
  console.log(`✅ Updated baseline with ${current.size} packages`);
  for (const [pkg, { pct }] of [...current.entries()].sort()) {
    console.log(`  ${pkg}: ${pct.toFixed(2)}%`);
  }
  process.exit(0);
  
} else {
  console.error("Usage: node tools/coverage-ratchet.mjs [check|update]");
  process.exit(1);
}
