#!/usr/bin/env node
/**
 * Coverage ratchet per package.
 *
 * Baseline is JSON:
 * { "packages/apps/src/<pkg>": <percentage>, "packages/api/app/Services/<Domain>": <percentage> }
 * Apps packages under src/lib use packages/apps/src/lib/<sub>.
 * API coverage counts only app/Services/<Domain>. The rest of packages/api is outside this ratchet.
 * `check` exit codes, first match wins:
 * 3 — a required report is missing or unreadable (no comparison, no issue)
 * 1 — a package in a report that was read dropped more than 0.5 points
 *     and has at least 50 statements (beats increases and disappeared keys)
 * 2 — coverage increased, a package is new, or a baseline key is absent
 * 0 — reports were read and none of the above apply
 * `update` keeps max(baseline, current) for existing keys, adds new keys,
 * and drops keys that disappeared. A drop is never written into the baseline.
 * `update --reseed` writes the current report as-is. It is the one-time
 * escape hatch when the baseline was seeded above what CI measures.
 * mail-core and Services/Mail are unshipped for v0.9 and are excluded.
 * `check --json` prints the machine-readable report on stdout and the human
 * report on stderr. Exit codes stay the same.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const THRESHOLD = 0.5;
export const MIN_STATEMENTS = 50;

const defaultRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const repoRoot = process.env.COVERAGE_RATCHET_ROOT || defaultRoot;
const baselinePath = path.join(repoRoot, "tools/coverage-baseline.json");
const appsCoveragePath = path.join(
  repoRoot,
  "packages/apps/coverage/coverage-summary.json",
);
const appsCoverageUnitPath = path.join(
  repoRoot,
  "packages/apps/coverage/unit/coverage-summary.json",
);
const appsCoverageJsdomPath = path.join(
  repoRoot,
  "packages/apps/coverage/jsdom/coverage-summary.json",
);
const apiCoveragePath = path.join(
  repoRoot,
  "packages/api/build/logs/clover.xml",
);

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
  else if (normalized.startsWith("src/"))
    rest = normalized.slice("src/".length);
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
    result.set(key, {
      pct: (counts.covered / counts.total) * 100,
      statements: counts.total,
    });
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
      if (!previous || counts.covered > previous.covered)
        files.set(filePath, counts);
    }
  }
  const buckets = new Map();
  for (const [filePath, counts] of files) {
    addCounts(buckets, appsPackageKey(filePath), counts.covered, counts.total);
  }
  return percentagesFromBuckets(buckets);
}

/**
 * File-level PHPUnit metrics include loc=. Class metrics inside <class> do not.
 * Attribute order varies, and ncloc= must not count as loc=.
 * @param {string} tag
 * @returns {{ statements: number, covered: number } | null}
 */
function readMetricsTag(tag) {
  const statements = /\bstatements="(\d+)"/.exec(tag);
  const covered = /\bcoveredstatements="(\d+)"/.exec(tag);
  if (!statements || !covered) return null;
  return {
    statements: Number(statements[1]),
    covered: Number(covered[1]),
  };
}

/**
 * @param {string} body text inside one <file>…</file>
 * @returns {{ statements: number, covered: number } | null}
 */
function fileLevelMetrics(body) {
  /** @type {string[]} */
  const tags = [];
  let cursor = 0;
  while (cursor < body.length) {
    const start = body.indexOf("<metrics", cursor);
    if (start === -1) break;
    const end = body.indexOf(">", start);
    if (end === -1) break;
    tags.push(body.slice(start, end + 1));
    cursor = end + 1;
  }
  if (tags.length === 0) return null;

  for (let i = tags.length - 1; i >= 0; i -= 1) {
    if (/(?:^|[\s])loc="/.test(tags[i])) return readMetricsTag(tags[i]);
  }
  return readMetricsTag(tags[tags.length - 1]);
}

/**
 * One forward scan. Each file body is sliced once; the tail of the document is not.
 * @param {string} xml
 * @returns {Map<string, {pct: number, statements: number}>}
 */
export function coverageFromClover(xml) {
  if (!xml.includes("<coverage")) {
    throw new Error("API coverage file is not clover");
  }

  const buckets = new Map();
  let cursor = 0;
  while (cursor < xml.length) {
    const fileStart = xml.indexOf("<file ", cursor);
    if (fileStart === -1) break;
    const tagEnd = xml.indexOf(">", fileStart);
    if (tagEnd === -1) break;
    const openTag = xml.slice(fileStart, tagEnd + 1);
    const nameMatch = /\bname="([^"]*)"/.exec(openTag);
    const fileEnd = xml.indexOf("</file>", tagEnd);
    if (!nameMatch || fileEnd === -1) {
      cursor = tagEnd + 1;
      continue;
    }
    const metrics = fileLevelMetrics(xml.slice(tagEnd + 1, fileEnd));
    if (metrics) {
      addCounts(
        buckets,
        apiServiceKey(nameMatch[1]),
        metrics.covered,
        metrics.statements,
      );
    }
    cursor = fileEnd + "</file>".length;
  }

  return percentagesFromBuckets(buckets);
}

/**
 * Parse API clover.xml without xml2js.
 * @returns {Map<string, {pct: number, statements: number}>}
 */
function parseApiCoverage() {
  if (!existsSync(apiCoveragePath)) {
    throw new Error(`API coverage file not found: ${apiCoveragePath}`);
  }

  const xml = readFileSync(apiCoveragePath, "utf8");
  return coverageFromClover(xml);
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

  const summaries = [];
  if (existsSync(appsCoverageUnitPath)) {
    summaries.push(JSON.parse(readFileSync(appsCoverageUnitPath, "utf8")));
  }
  if (existsSync(appsCoverageJsdomPath)) {
    summaries.push(JSON.parse(readFileSync(appsCoverageJsdomPath, "utf8")));
  }

  if (summaries.length === 0) {
    throw new Error(
      `Apps coverage files not found: ${appsCoveragePath}, ${appsCoverageUnitPath}, ${appsCoverageJsdomPath}`,
    );
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
 * Existing keys stay at max(baseline, current) unless `reseed` is set.
 * Reseed copies the current report and drops keys the report does not contain.
 * Keys absent from the report are omitted, so a rename drops the old key.
 * @param {Map<string, {pct: number, statements: number}>} coverage
 * @param {Map<string, number>} baseline
 * @param {{ reseed?: boolean }} [options]
 * @returns {{ packages: Record<string, number>, lowered: Array<{pkg: string, from: number, to: number}>, removed: Array<{pkg: string, from: number}> }}
 */
function writeBaseline(coverage, baseline, options = {}) {
  const reseed = options.reseed === true;
  const obj = {};
  /** @type {Array<{pkg: string, from: number, to: number}>} */
  const lowered = [];
  for (const [pkg, { pct }] of [...coverage.entries()].sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    const current = roundPct(pct);
    const previous = baseline.get(pkg);
    const previousPct =
      previous === undefined ? undefined : roundPct(Number(previous));
    const hasPrevious =
      previousPct !== undefined && Number.isFinite(previousPct);
    if (reseed) {
      if (hasPrevious && current < previousPct) {
        lowered.push({ pkg, from: previousPct, to: current });
      }
      obj[pkg] = current;
    } else {
      obj[pkg] = hasPrevious ? Math.max(previousPct, current) : current;
    }
  }
  /** @type {Array<{pkg: string, from: number}>} */
  const removed = [];
  if (reseed) {
    for (const [pkg, previous] of baseline) {
      if (coverage.has(pkg)) continue;
      const previousPct = roundPct(Number(previous));
      if (!Number.isFinite(previousPct)) continue;
      removed.push({ pkg, from: previousPct });
    }
    removed.sort((a, b) => a.pkg.localeCompare(b.pkg));
  }
  writeFileSync(baselinePath, `${JSON.stringify(obj, null, 2)}\n`);
  return { packages: obj, lowered, removed };
}

/**
 * Check coverage against baseline
 * @param {Map<string, {pct: number, statements: number}>} current
 * @param {Map<string, number>} baseline
 * @returns {{errors: string[], warnings: string[], increases: Array<{pkg: string, from: number, to: number}>, proposals: Array<{pkg: string, pct: number}>, missing: string[]}}
 */
function checkCoverage(current, baseline) {
  const errors = [];
  const warnings = [];
  const increases = [];
  const proposals = [];
  const missing = [];

  for (const [pkg, { pct: currentPct, statements }] of current) {
    const baselinePct = baseline.get(pkg);
    if (baselinePct === undefined) {
      proposals.push({ pkg, pct: roundPct(currentPct) });
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
      increases.push({
        pkg,
        from: roundPct(baselinePct),
        to: roundPct(currentPct),
      });
    }
  }

  for (const [pkg, baselinePct] of baseline) {
    if (!current.has(pkg)) {
      missing.push(pkg);
      warnings.push(
        `${pkg}: package missing from current coverage (was ${roundPct(baselinePct).toFixed(2)}%)`,
      );
    }
  }

  missing.sort();
  return { errors, warnings, increases, proposals, missing };
}

/**
 * Both reports are required. A partial read must not look like a pass.
 * @returns {Map<string, {pct: number, statements: number}>}
 */
function loadReports() {
  let appsCoverage;
  let apiCoverage;
  try {
    appsCoverage = parseAppsCoverage();
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Apps coverage report is missing or unreadable: ${detail}`);
  }
  try {
    apiCoverage = parseApiCoverage();
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`API coverage report is missing or unreadable: ${detail}`);
  }
  return new Map([...appsCoverage, ...apiCoverage]);
}

/**
 * @param {{errors: string[], warnings: string[], increases: Array<{pkg: string, from: number, to: number}>, proposals: Array<{pkg: string, pct: number}>}} report
 * @param {{ info: (line: string) => void, error: (line: string) => void }} out
 */
function writeHumanReport(report, out) {
  const { errors, warnings, increases, proposals } = report;
  out.info("Checking coverage ratchet...\n");

  if (warnings.length > 0) {
    out.info("⚠️  Warnings:\n");
    for (const warning of warnings) out.info(`  ${warning}`);
    out.info("");
  }

  if (increases.length > 0) {
    out.info("📈 Coverage increases detected:\n");
    for (const { pkg, from, to } of increases) {
      out.info(`  ${pkg}: ${from.toFixed(2)}% → ${to.toFixed(2)}%`);
    }
    out.info("");
  }

  if (proposals.length > 0) {
    out.info("📦 New packages detected:\n");
    for (const { pkg, pct } of proposals) {
      out.info(`  ${pkg}: ${pct.toFixed(2)}%`);
    }
    out.info("");
  }

  if (errors.length > 0) {
    out.error("❌ Coverage ratchet check failed:\n");
    for (const error of errors) out.error(`  ${error}`);
    out.error(
      "\nCoverage per package can only go up. Run 'node tools/coverage-ratchet.mjs update' after improving coverage.",
    );
    return;
  }

  out.info("✅ Coverage ratchet check passed");
}

function exitCodeFor(report) {
  if (report.errors.length > 0) return 1;
  if (
    report.increases.length > 0 ||
    report.proposals.length > 0 ||
    report.missing.length > 0
  ) {
    return 2;
  }
  return 0;
}

function runCheck(json) {
  let current;
  try {
    current = loadReports();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(3);
  }

  const baseline = readBaseline();
  let report;
  try {
    report = checkCoverage(current, baseline);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(3);
  }

  const push = (sink) => (line) => {
    sink(`${line}\n`);
  };
  if (json) {
    writeHumanReport(report, {
      info: push(console.error),
      error: push(console.error),
    });
    process.stdout.write(`${JSON.stringify(report)}\n`);
  } else {
    writeHumanReport(report, {
      info: push(console.log),
      error: push(console.error),
    });
  }

  process.exit(exitCodeFor(report));
}

function runUpdate(reseed) {
  let current;
  try {
    current = loadReports();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(3);
  }

  const { packages, lowered, removed } = writeBaseline(
    current,
    readBaseline(),
    {
      reseed,
    },
  );

  if (reseed) {
    console.log(
      "Reseeded baseline from current reports (previous values ignored)",
    );
    for (const { pkg, from, to } of lowered) {
      console.log(`  ${pkg}: ${from.toFixed(2)}% -> ${to.toFixed(2)}%`);
    }
    for (const { pkg, from } of removed) {
      console.log(`  ${pkg}: ${from.toFixed(2)}% -> removed`);
    }
    console.log();
  } else {
    console.log("Updating coverage baseline...\n");
  }

  console.log(
    `✅ Updated baseline with ${Object.keys(packages).length} packages`,
  );
  for (const [pkg, pct] of Object.entries(packages)) {
    const currentPct = roundPct(current.get(pkg).pct);
    if (!reseed && currentPct < pct) {
      console.log(
        `  ${pkg}: kept ${pct.toFixed(2)}% (report ${currentPct.toFixed(2)}%)`,
      );
    } else {
      console.log(`  ${pkg}: ${pct.toFixed(2)}%`);
    }
  }
  process.exit(0);
}

const args = process.argv.slice(2);
const command = args.find((arg) => !arg.startsWith("--"));
const json = args.includes("--json");
const reseed = args.includes("--reseed");
const knownFlags = new Set(["--json", "--reseed"]);
const unknown = args.filter(
  (arg) => arg.startsWith("--") && !knownFlags.has(arg),
);

function printUsage() {
  console.error(
    "Usage: node tools/coverage-ratchet.mjs <check|update> [--json] [--reseed]",
  );
}

if (unknown.length > 0 || (command !== "check" && command !== "update")) {
  printUsage();
  process.exit(3);
}

if (reseed && command !== "update") {
  console.error("--reseed is only valid with update");
  printUsage();
  process.exit(3);
}

if (command === "update" && json) {
  console.error("--json is only valid with check");
  printUsage();
  process.exit(3);
}

if (command === "check") runCheck(json);
else runUpdate(reseed);
