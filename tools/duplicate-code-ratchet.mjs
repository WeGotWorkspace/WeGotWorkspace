#!/usr/bin/env node
/**
 * Duplicate-code ratchet (jscpd).
 *
 * Scans two scopes with jscpd and compares each scope's clone count and
 * duplicated-line total to `tools/duplicate-code-baseline.json`.
 *
 * `check` fails when a total grew. When a total dropped it passes and prints
 * a notice to lower the baseline with `update`. A drop does not fail because
 * each total is one number for a whole scope: if drops failed, every PR that
 * removes some duplication would edit the same baseline line, and parallel
 * PRs would keep conflicting in the merge queue.
 * `update` only lowers totals. It never raises one. Raising a total, a
 * jscpd upgrade, or a threshold change is a hand edit of the baseline,
 * which needs code-owner review (.github/CODEOWNERS).
 * `report [--top N]` prints the totals and the largest duplicated blocks
 * with file:line ranges, so a developer can find what tripped `check`.
 *
 * Determinism: this script builds the file list itself (same exclusions as
 * the file-size ratchet, plus story, mock and test folders) and copies those
 * files into a temp directory, so jscpd scans exactly that list. No ignore
 * globs, .gitignore or `.jscpd.json` take part. Every option that changes the
 * totals is pinned: thresholds from the baseline, `--mode mild`, source
 * limits that fail loudly instead of skipping, `--no-gitignore`, no
 * symlinks, and an empty config file. The JSON report stays in the temp
 * directory.
 *
 * jscpd 4 (JavaScript engine) on purpose: jscpd 5.4.1 (Rust engine) missed
 * a 120-line block pasted verbatim from a 946-line file in this repo.
 *
 * Thresholds: 70 tokens and 10 lines. Lower values report import lists,
 * prop spreads and short guard clauses; higher values miss copied methods
 * of 10-15 lines, which are the copies #1639 and #1641 are about.
 */
import { execFile } from "node:child_process";
import {
  copyFileSync,
  mkdirSync,
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

import { countLines, isExcluded } from "./file-size-ratchet.mjs";

const execFileAsync = promisify(execFile);
const require = createRequire(import.meta.url);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const baselinePath = path.join(repoRoot, "tools/duplicate-code-baseline.json");
const updateCommand = "pnpm duplicate-code:update";
const reportCommand = "pnpm duplicate-code:report";

/**
 * `formats` are the jscpd formats that count. jscpd 4 also tokenizes the
 * expressions inside TSX as a separate "javascript" stream. Clones in that
 * stream join pieces from far apart in a file (a "281-line" clone of two
 * unrelated components), so they are left out of the totals and the report.
 */
export const DUPLICATE_SCOPES = [
  {
    root: "packages/apps/src",
    extensions: new Set([".ts", ".tsx"]),
    formats: ["typescript", "tsx"],
  },
  { root: "packages/api/app", extensions: new Set([".php"]), formats: ["php"] },
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
 * jscpd skips a source over these limits without saying so. The mirror step
 * fails instead, so a growing file cannot drop out of the scan.
 */
export const MAX_SOURCE_LINES = 20000;
export const MAX_SOURCE_BYTES = 2 * 1024 * 1024;

/**
 * @param {{ formats: string[] }} scope
 * @param {{ scanRoot: string, outDir: string, configPath: string, minTokens: number, minLines: number }} options
 */
export function jscpdArgs(scope, { scanRoot, outDir, configPath, minTokens, minLines }) {
  return [
    scanRoot,
    "--config",
    configPath,
    "--min-tokens",
    String(minTokens),
    "--min-lines",
    String(minLines),
    "--format",
    scope.formats.join(","),
    "--mode",
    "mild",
    "--max-lines",
    String(MAX_SOURCE_LINES),
    "--max-size",
    String(MAX_SOURCE_BYTES),
    "--no-gitignore",
    "--noSymlinks",
    "--absolute",
    "--no-colors",
    "--silent",
    "--reporters",
    "json",
    "--output",
    outDir,
  ];
}

/**
 * Copy the listed files to `mirrorRoot` under their repo-relative paths, so
 * jscpd scans exactly this list: no ignore globs, no .gitignore, no config.
 * @param {string[]} files repo-relative
 * @param {string} baseDir
 * @param {string} mirrorRoot
 */
export function mirrorFiles(files, baseDir, mirrorRoot) {
  for (const rel of files) {
    const source = path.join(baseDir, rel);
    const { size } = statSync(source);
    const lines = countLines(readFileSync(source, "utf8"));
    if (size > MAX_SOURCE_BYTES || lines > MAX_SOURCE_LINES) {
      throw new Error(
        `${rel}: ${lines} lines / ${size} bytes is over the duplicate scan limit ` +
          `(${MAX_SOURCE_LINES} lines / ${MAX_SOURCE_BYTES} bytes); raise the limit in tools/duplicate-code-ratchet.mjs`,
      );
    }
    const target = path.join(mirrorRoot, rel);
    mkdirSync(path.dirname(target), { recursive: true });
    copyFileSync(source, target);
  }
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
 * Totals and blocks of the counted formats only.
 * @param {{ statistics: { formats: Record<string, { total: { clones: number, duplicatedLines: number } }> }, duplicates: any[] }} report
 * @param {string} baseDir
 * @param {string[]} formats
 */
export function summarizeReport(report, baseDir, formats) {
  const toLocation = (file) => ({
    path: path.relative(baseDir, file.name).split(path.sep).join("/"),
    start: file.start,
    end: file.end,
  });
  const counted = new Set(formats);
  const blocks = report.duplicates
    .filter((clone) => counted.has(clone.format))
    .map((clone) => {
      const [first, second] = [toLocation(clone.firstFile), toLocation(clone.secondFile)].sort(
        compareLocation,
      );
      return { lines: clone.lines, tokens: clone.tokens, first, second };
    });
  const totals = { clones: 0, duplicatedLines: 0 };
  for (const format of formats) {
    const total = report.statistics.formats[format]?.total;
    if (!total) continue;
    for (const key of Object.keys(totals)) totals[key] += total[key];
  }
  return { ...totals, blocks: largestBlocks(blocks) };
}

/** jscpd 4 exports neither its package.json nor its bin, so walk up from its entry. */
function jscpdPackageDir() {
  let dir = path.dirname(require.resolve("jscpd"));
  while (!statSync(path.join(dir, "package.json"), { throwIfNoEntry: false })?.isFile()) {
    const parent = path.dirname(dir);
    if (parent === dir) throw new Error("jscpd package.json not found");
    dir = parent;
  }
  return dir;
}

export function installedJscpdVersion() {
  return JSON.parse(readFileSync(path.join(jscpdPackageDir(), "package.json"), "utf8")).version;
}

/**
 * Run jscpd once per scope (in parallel) on a temp mirror of the listed
 * files, and summarize each report with repo-relative paths.
 * @param {{ baseDir?: string, minTokens: number, minLines: number }} options
 * @returns {Promise<Record<string, ReturnType<typeof summarizeReport>>>}
 */
export async function measureScopes({ baseDir = repoRoot, minTokens, minLines }) {
  const jscpd = path.join(jscpdPackageDir(), "bin/jscpd");
  // jscpd reports canonical absolute paths; /tmp and /var are symlinks on macOS.
  const tempDir = realpathSync(mkdtempSync(path.join(os.tmpdir(), "wgw-duplicate-code-")));
  try {
    const configPath = path.join(tempDir, "jscpd.json");
    writeFileSync(configPath, "{}\n");
    const entries = await Promise.all(
      DUPLICATE_SCOPES.map(async (scope, index) => {
        const mirrorRoot = path.join(tempDir, `scope-${index}`);
        const files = listScopeFiles(scope, baseDir);
        mirrorFiles(files, baseDir, mirrorRoot);
        const outDir = path.join(tempDir, `report-${index}`);
        const args = jscpdArgs(scope, {
          scanRoot: path.join(mirrorRoot, scope.root),
          outDir,
          configPath,
          minTokens,
          minLines,
        });
        await execFileAsync(process.execPath, [jscpd, ...args], {
          cwd: mirrorRoot,
          maxBuffer: 64 * 1024 * 1024,
          env: { ...process.env, NO_COLOR: "1" },
        });
        const reportPath = path.join(outDir, "jscpd-report.json");
        // jscpd writes no report when no file reaches the token minimum.
        const report = statSync(reportPath, { throwIfNoEntry: false })
          ? JSON.parse(readFileSync(reportPath, "utf8"))
          : { statistics: { formats: {} }, duplicates: [] };
        return [
          scope.root,
          { ...summarizeReport(report, mirrorRoot, scope.formats), files: files.length },
        ];
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
 * @returns {{ errors: string[], notices: string[] }}
 */
export function evaluate(current, baseline, { jscpdVersion }) {
  const version = versionError(baseline, jscpdVersion);
  if (version) return { errors: [version], notices: [] };
  const errors = scopeErrors(current, baseline);
  if (errors.length > 0) return { errors, notices: [] };
  const notices = [];
  for (const root of scopeRoots) {
    for (const { key, label } of metrics) {
      const stored = baseline.scopes[root][key];
      const actual = current[root][key];
      if (actual > stored) errors.push(`${root}: ${label} grew from ${stored} to ${actual}`);
      if (actual < stored) {
        notices.push(`${root}: ${label} dropped from ${stored} to ${actual}; ${updateCommand} can lower the baseline`);
      }
    }
  }
  return { errors, notices };
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
  const scanned = totals.files === undefined ? "" : ` in ${totals.files} scanned files`;
  const vs = stored ? ` (baseline ${stored.clones} clones, ${stored.duplicatedLines} lines)` : "";
  return `${root}: ${totals.clones} clones, ${totals.duplicatedLines} duplicated lines${scanned}${vs}`;
}

async function check() {
  const { baseline, current, seconds, jscpdVersion } = await measureAgainstBaseline();
  const { errors, notices } = evaluate(current, baseline, { jscpdVersion });
  if (errors.length > 0) {
    console.error(`Duplicate-code ratchet failed (${errors.length}):\n`);
    for (const error of errors) console.error(`  - ${error}`);
    console.error(`\nRun ${reportCommand} to list the largest duplicated blocks.`);
    process.exit(1);
  }
  for (const root of scopeRoots) console.log(totalsLine(root, current[root]));
  for (const notice of notices) console.log(`Notice: ${notice}`);
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
