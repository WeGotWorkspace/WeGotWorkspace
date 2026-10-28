#!/usr/bin/env node
/**
 * Duplicate-code ratchet (jscpd).
 *
 * Scans two scopes with jscpd and compares each scope's clone count and
 * duplicated-line total to `tools/duplicate-code-baseline.json`.
 *
 * `check` fails when a total grew, and when it dropped while the baseline
 * still holds the old number (lower it with `update` in the same change).
 * `update` only lowers totals. It never raises one. Raising a total, a
 * jscpd upgrade, or a threshold change is a hand edit of the baseline,
 * which needs code-owner review (.github/CODEOWNERS).
 * `report [--top N]` prints the totals and the largest duplicated blocks
 * with file:line ranges, so a developer can find what tripped `check`.
 *
 * Determinism: this script builds the file list itself (same exclusions as
 * the file-size ratchet, plus story, mock and test folders), sorts it, and
 * passes it to jscpd with every option that changes the totals pinned:
 * thresholds from the baseline, `--mode mild`, `--kind exact`,
 * `--max-size 1mb`, one worker, `--no-gitignore`, and an empty config file
 * so no `.jscpd.json` in the tree is read. The JSON report goes to a temp
 * directory outside the repository.
 *
 * Thresholds: 70 tokens and 10 lines. Lower values report import lists,
 * prop spreads and short guard clauses; higher values miss copied methods
 * of 10-15 lines, which are the copies #1639 and #1641 are about.
 */
import { execFile } from "node:child_process";
import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { isExcluded } from "./file-size-ratchet.mjs";

const execFileAsync = promisify(execFile);
const require = createRequire(import.meta.url);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const baselinePath = path.join(repoRoot, "tools/duplicate-code-baseline.json");
const updateCommand = "pnpm duplicate-code:update";
const reportCommand = "pnpm duplicate-code:report";

export const DUPLICATE_SCOPES = [
  { root: "packages/apps/src", extensions: new Set([".ts", ".tsx"]), format: "typescript,tsx" },
  { root: "packages/api/app", extensions: new Set([".php"]), format: "php" },
];

const scopeRoots = DUPLICATE_SCOPES.map((scope) => scope.root);

/** Folders that hold stories, mocks or tests even when the file name does not say so. */
const excludedDirs = new Set(["stories", "mock", "mocks", "tests", "__tests__"]);
const excludedFixtures = /\.fixtures\.(ts|tsx)$/;

const metrics = [
  { key: "clones", label: "clones" },
  { key: "duplicatedLines", label: "duplicated lines" },
];

/**
 * The file-size ratchet's exclusions, plus story/mock/test folders and
 * `*.fixtures.ts(x)`: copies between stories or mock data are not the target.
 * @param {string} relPath repo-relative, `/`-separated
 */
export function isExcludedFromDuplicateScan(relPath) {
  if (isExcluded(relPath)) return true;
  const segments = relPath.split("/");
  const fileName = segments.pop() ?? "";
  if (excludedFixtures.test(fileName)) return true;
  return segments.some((segment) => excludedDirs.has(segment));
}

/**
 * @param {{ root: string, extensions: Set<string> }} scope
 * @param {string} [baseDir] repository root (tests pass a temp directory)
 * @returns {string[]} sorted repo-relative paths
 */
export function listScopeFiles(scope, baseDir = repoRoot) {
  const rootAbs = path.join(baseDir, scope.root);
  if (!statSync(rootAbs, { throwIfNoEntry: false })?.isDirectory()) {
    throw new Error(`scope root missing: ${scope.root}`);
  }
  /** @type {string[]} */
  const files = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (!entry.isFile() || !scope.extensions.has(path.extname(entry.name))) continue;
      const rel = path.relative(baseDir, full).split(path.sep).join("/");
      if (!isExcludedFromDuplicateScan(rel)) files.push(rel);
    }
  };
  walk(rootAbs);
  return files.sort();
}

/**
 * @param {{ format: string }} scope
 * @param {string[]} files
 * @param {{ outDir: string, configPath: string, minTokens: number, minLines: number }} options
 */
export function jscpdArgs(scope, files, { outDir, configPath, minTokens, minLines }) {
  return [
    "--config",
    configPath,
    "--min-tokens",
    String(minTokens),
    "--min-lines",
    String(minLines),
    "--format",
    scope.format,
    "--mode",
    "mild",
    "--kind",
    "exact",
    "--max-size",
    "1mb",
    "--workers",
    "1",
    "--no-gitignore",
    "--absolute",
    "--no-colors",
    "--no-tips",
    "--silent",
    "--reporters",
    "json",
    "--output",
    outDir,
    ...files,
  ];
}

function compareLocation(a, b) {
  if (a.path !== b.path) return a.path < b.path ? -1 : 1;
  return a.start - b.start;
}

/**
 * Largest blocks first; ties by location so output is stable across machines.
 * @template {{ lines: number, first: { path: string, start: number }, second: { path: string, start: number } }} T
 * @param {T[]} blocks
 * @param {number} [limit]
 * @returns {T[]}
 */
export function largestBlocks(blocks, limit = blocks.length) {
  return [...blocks]
    .sort(
      (a, b) =>
        b.lines - a.lines ||
        compareLocation(a.first, b.first) ||
        compareLocation(a.second, b.second),
    )
    .slice(0, limit);
}

/**
 * @param {{ statistics: { total: { clones: number, duplicatedLines: number, sources: number } }, duplicates: any[] }} report
 * @param {string} baseDir
 */
export function summarizeReport(report, baseDir) {
  const toLocation = (file) => ({
    path: path.relative(baseDir, file.name).split(path.sep).join("/"),
    start: file.start,
    end: file.end,
  });
  const blocks = report.duplicates.map((clone) => {
    const [first, second] = [toLocation(clone.firstFile), toLocation(clone.secondFile)].sort(
      compareLocation,
    );
    return { lines: clone.lines, tokens: clone.tokens, first, second };
  });
  const { clones, duplicatedLines, sources } = report.statistics.total;
  return { clones, duplicatedLines, sources, blocks: largestBlocks(blocks) };
}

export function installedJscpdVersion() {
  return require("jscpd/package.json").version;
}

/**
 * Run jscpd once per scope (in parallel) and summarize each report.
 * @param {{ baseDir?: string, minTokens: number, minLines: number }} options
 * @returns {Promise<Record<string, ReturnType<typeof summarizeReport>>>}
 */
export async function measureScopes({ baseDir = repoRoot, minTokens, minLines }) {
  // jscpd reports canonical absolute paths; /tmp and /var are symlinks on macOS.
  const base = realpathSync(baseDir);
  const jscpd = require.resolve("jscpd/run-jscpd.js");
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "wgw-duplicate-code-"));
  try {
    const configPath = path.join(tempDir, "jscpd.json");
    writeFileSync(configPath, "{}\n");
    const entries = await Promise.all(
      DUPLICATE_SCOPES.map(async (scope, index) => {
        const files = listScopeFiles(scope, base);
        const outDir = path.join(tempDir, String(index));
        const args = jscpdArgs(scope, files, { outDir, configPath, minTokens, minLines });
        await execFileAsync(process.execPath, [jscpd, ...args], {
          cwd: base,
          maxBuffer: 64 * 1024 * 1024,
          env: { ...process.env, NO_COLOR: "1", JSCPD_NO_TIPS: "1" },
        });
        const report = JSON.parse(readFileSync(path.join(outDir, "jscpd-report.json"), "utf8"));
        return [scope.root, summarizeReport(report, base)];
      }),
    );
    return Object.fromEntries(entries);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

function isCount(value) {
  return Number.isInteger(value) && value >= 0;
}

/**
 * @param {string} text
 * @returns {{ jscpd: string, minTokens: number, minLines: number, scopes: Record<string, { clones: number, duplicatedLines: number }> }}
 */
export function parseBaseline(text) {
  const data = JSON.parse(text);
  if (typeof data?.jscpd !== "string" || data.jscpd === "") {
    throw new Error("baseline: jscpd must be a version string");
  }
  for (const key of ["minTokens", "minLines"]) {
    if (!Number.isInteger(data[key]) || data[key] < 1) {
      throw new Error(`baseline: ${key} must be a positive integer`);
    }
  }
  if (typeof data.scopes !== "object" || data.scopes === null) {
    throw new Error("baseline: scopes must be an object");
  }
  for (const [root, totals] of Object.entries(data.scopes)) {
    for (const { key } of metrics) {
      if (!isCount(totals?.[key])) {
        throw new Error(`baseline: ${root} ${key} must be a non-negative integer`);
      }
    }
  }
  return data;
}

/** Stable key order and a trailing newline, so `update` diffs stay minimal. */
export function formatBaseline(baseline) {
  const scopes = Object.fromEntries(
    Object.keys(baseline.scopes)
      .sort()
      .map((root) => [
        root,
        {
          clones: baseline.scopes[root].clones,
          duplicatedLines: baseline.scopes[root].duplicatedLines,
        },
      ]),
  );
  const ordered = {
    jscpd: baseline.jscpd,
    minTokens: baseline.minTokens,
    minLines: baseline.minLines,
    scopes,
  };
  return `${JSON.stringify(ordered, null, 2)}\n`;
}

function versionError(baseline, jscpdVersion) {
  if (baseline.jscpd === jscpdVersion) return null;
  return (
    `jscpd ${jscpdVersion} is installed but the baseline was measured with ${baseline.jscpd}. ` +
    "A jscpd upgrade re-measures every scope: set the new version and totals in " +
    "tools/duplicate-code-baseline.json by hand in the same change (code-owner review)."
  );
}

function scopeErrors(current, baseline) {
  /** @type {string[]} */
  const errors = [];
  for (const root of scopeRoots) {
    if (!baseline.scopes[root]) errors.push(`${root}: scope has no baseline entry`);
    else if (!current[root]) errors.push(`${root}: scope was not measured`);
  }
  for (const root of Object.keys(baseline.scopes)) {
    if (!scopeRoots.includes(root)) errors.push(`${root}: baseline entry is not a scanned scope`);
  }
  return errors;
}

/**
 * Pure check of measured totals against the baseline.
 * @param {Record<string, { clones: number, duplicatedLines: number }>} current
 * @param {ReturnType<typeof parseBaseline>} baseline
 * @param {{ jscpdVersion: string }} settings
 * @returns {{ errors: string[] }}
 */
export function evaluate(current, baseline, { jscpdVersion }) {
  const version = versionError(baseline, jscpdVersion);
  if (version) return { errors: [version] };
  const errors = scopeErrors(current, baseline);
  if (errors.length > 0) return { errors };
  for (const root of scopeRoots) {
    for (const { key, label } of metrics) {
      const stored = baseline.scopes[root][key];
      const actual = current[root][key];
      if (actual > stored) errors.push(`${root}: ${label} grew from ${stored} to ${actual}`);
      if (actual < stored) {
        errors.push(
          `${root}: ${label} dropped from ${stored} to ${actual}; run ${updateCommand} and commit the baseline`,
        );
      }
    }
  }
  return { errors };
}

/**
 * Pure update: lowers totals that dropped and never raises one.
 * @param {Record<string, { clones: number, duplicatedLines: number }>} current
 * @param {ReturnType<typeof parseBaseline>} baseline
 * @param {{ jscpdVersion: string }} settings
 * @returns {{ baseline: ReturnType<typeof parseBaseline> | null, errors: string[] }}
 */
export function nextBaseline(current, baseline, { jscpdVersion }) {
  const version = versionError(baseline, jscpdVersion);
  if (version) return { baseline: null, errors: [version] };
  const errors = scopeErrors(current, baseline);
  if (errors.length > 0) return { baseline: null, errors };
  /** @type {Record<string, { clones: number, duplicatedLines: number }>} */
  const scopes = {};
  for (const root of scopeRoots) {
    scopes[root] = { ...baseline.scopes[root] };
    for (const { key, label } of metrics) {
      const stored = baseline.scopes[root][key];
      const actual = current[root][key];
      if (actual > stored) {
        errors.push(`${root}: update refuses to raise ${label} from ${stored} to ${actual}`);
      } else {
        scopes[root][key] = actual;
      }
    }
  }
  if (errors.length > 0) return { baseline: null, errors };
  return { baseline: { ...baseline, scopes }, errors };
}

function formatBlock(block) {
  const at = (location) => `${location.path}:${location.start}-${location.end}`;
  return `${String(block.lines).padStart(4)} lines  ${at(block.first)}  <->  ${at(block.second)}`;
}

function readBaseline() {
  return parseBaseline(readFileSync(baselinePath, "utf8"));
}

async function measureAgainstBaseline() {
  const baseline = readBaseline();
  const started = performance.now();
  const current = await measureScopes({
    minTokens: baseline.minTokens,
    minLines: baseline.minLines,
  });
  const seconds = ((performance.now() - started) / 1000).toFixed(1);
  return { baseline, current, seconds, jscpdVersion: installedJscpdVersion() };
}

function totalsLine(root, totals, stored) {
  const vs = stored ? ` (baseline ${stored.clones} clones, ${stored.duplicatedLines} lines)` : "";
  return `${root}: ${totals.clones} clones, ${totals.duplicatedLines} duplicated lines in ${totals.sources} files${vs}`;
}

async function check() {
  const { baseline, current, seconds, jscpdVersion } = await measureAgainstBaseline();
  const { errors } = evaluate(current, baseline, { jscpdVersion });
  if (errors.length > 0) {
    console.error(`Duplicate-code ratchet failed (${errors.length}):\n`);
    for (const error of errors) console.error(`  - ${error}`);
    console.error(`\nRun ${reportCommand} to list the largest duplicated blocks.`);
    process.exit(1);
  }
  for (const root of scopeRoots) console.log(totalsLine(root, current[root]));
  console.log(`Duplicate-code ratchet passed (jscpd ${jscpdVersion}, ${seconds}s).`);
}

async function update() {
  const { baseline, current, jscpdVersion } = await measureAgainstBaseline();
  const { baseline: next, errors } = nextBaseline(current, baseline, { jscpdVersion });
  if (!next) {
    for (const error of errors) console.error(error);
    process.exit(1);
  }
  writeFileSync(baselinePath, formatBaseline(next));
  for (const root of scopeRoots) console.log(totalsLine(root, next.scopes[root]));
  console.log("Duplicate-code baseline updated.");
}

async function report(args) {
  const topIndex = args.indexOf("--top");
  const top = topIndex === -1 ? 15 : Number(args[topIndex + 1]);
  if (!Number.isInteger(top) || top < 1) {
    console.error("usage: duplicate-code-ratchet.mjs report [--top N]");
    process.exit(2);
  }
  const { baseline, current, seconds, jscpdVersion } = await measureAgainstBaseline();
  console.log(
    `jscpd ${jscpdVersion}, min ${baseline.minTokens} tokens / ${baseline.minLines} lines, ${seconds}s\n`,
  );
  for (const root of scopeRoots) {
    console.log(totalsLine(root, current[root], baseline.scopes[root]));
    for (const block of current[root].blocks.slice(0, top)) console.log(`  ${formatBlock(block)}`);
    console.log("");
  }
}

async function main() {
  const [command, ...rest] = process.argv.slice(2).filter((arg) => arg !== "--");
  if (command === "check") return check();
  if (command === "update") return update();
  if (command === "report") return report(rest);
  console.error("usage: duplicate-code-ratchet.mjs check | update | report [--top N]");
  process.exit(2);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error?.stderr?.toString?.() || error?.message || String(error));
    process.exit(1);
  });
}
