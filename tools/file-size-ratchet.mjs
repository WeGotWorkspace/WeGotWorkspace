#!/usr/bin/env node
/**
 * 800-line source ratchet.
 *
 * Baseline rows are `path<TAB>count<TAB>reason`, sorted by path.
 * `check` fails when a counted file over 800 is missing, grew, shrank
 * without an update, or is still listed at or under 800.
 * `update` only lowers a stored count or deletes a row that is now <= 800.
 * It never raises a count and never adds a path.
 * `rebaseline` rewrites existing rows to the current line count (may raise).
 * Use it only to refresh a stale baseline after integrating main — not to
 * excuse growth on a feature PR. Never called from CI or done gates.
 * CI (`check-growth`) warns when a count rises or a new baseline row appears
 * versus the PR base. Raising the baseline requires code-owner review of
 * `tools/file-size-baseline.tsv` (not a label bypass).
 */
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const baselinePath = path.join(repoRoot, "tools/file-size-baseline.tsv");
const ceiling = 800;

export const FILE_SIZE_RULE =
  "A new counted source file over 800 lines is a merge block unless its baseline entry carries an approved reason. A baselined file is a merge block when its line count grows, or when it shrinks and the stored integer was not lowered.";

const docPaths = [
  ".agents/skills/clean-code/smells.md",
  ".agents/skills/code-review/SKILL.md",
  ".agents/skills/developer/done-checklist.md",
  ".agents/skills/developer/SKILL.md",
  ".agents/POLICY.md",
  "AGENTS.md",
];

const trees = [
  { root: "packages/apps/src", extensions: new Set([".ts", ".tsx"]) },
  { root: "tools/mcp-server/src", extensions: new Set([".ts", ".tsx"]) },
  { root: "packages/api/app", extensions: new Set([".php"]) },
];

const countedRoots = trees.map((tree) => tree.root);

const excludedName = /\.(test|spec|stories|mock|fixture)\.(ts|tsx)$|\.d\.ts$/;

function isExcluded(relPath) {
  const normalized = relPath.split(path.sep).join("/");
  if (excludedName.test(path.basename(normalized))) return true;
  return (
    normalized.includes("/__mocks__/") ||
    normalized.startsWith("__mocks__/") ||
    normalized.includes("/test-utils/") ||
    normalized.startsWith("test-utils/") ||
    normalized.includes("/fixtures/") ||
    normalized.startsWith("fixtures/")
  );
}

/** Count lines so a file with no trailing newline still counts its last line. */
export function countLines(text) {
  if (text.length === 0) return 0;
  const parts = text.split("\n");
  return text.endsWith("\n") ? parts.length - 1 : parts.length;
}

export function isUnderCountedTree(filePath) {
  return countedRoots.some((root) => filePath === root || filePath.startsWith(`${root}/`));
}

/**
 * Strip comments/strings enough that brace matching and body `use` scans
 * do not trip on noise. Preserves newlines so offsets stay line-aligned.
 * @param {string} src
 */
export function stripPhpNoise(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, " "))
    .replace(/\/\/[^\n]*/g, "")
    .replace(/'(?:\\.|[^'\\])*'/g, "''")
    .replace(/"(?:\\.|[^"\\])*"/g, '""')
    .replace(/<<<(['"]?)(\w+)\1[\s\S]*?\n\2;?/g, "''");
}

/**
 * Trait names from `use Trait;` inside class/trait/interface/enum bodies.
 * Header `use Foo\Bar;` imports are ignored.
 * @param {string} phpSource
 * @returns {string[]}
 */
export function extractBodyTraitUses(phpSource) {
  const clean = stripPhpNoise(phpSource);
  /** @type {string[]} */
  const bodies = [];
  const declRe = /\b(class|trait|interface|enum)\s+\w+[^{]*\{/g;
  let match;
  while ((match = declRe.exec(clean))) {
    let i = match.index + match[0].length - 1;
    let depth = 0;
    for (; i < clean.length; i++) {
      const ch = clean[i];
      if (ch === "{") depth++;
      else if (ch === "}") {
        depth--;
        if (depth === 0) {
          bodies.push(clean.slice(match.index + match[0].length - 1, i + 1));
          break;
        }
      }
    }
  }

  /** @type {Set<string>} */
  const names = new Set();
  for (const body of bodies) {
    const useRe = /^\s*use\s+(?!function\b|const\b)([^;]+);/gm;
    let useMatch;
    while ((useMatch = useRe.exec(body))) {
      for (const part of useMatch[1].split(",")) {
        const name = part.trim().split(/\s+as\s+/i)[0].trim().replace(/^\\/, "");
        if (name) names.add(name);
      }
    }
  }
  return [...names];
}

/**
 * @param {string} rel
 * @param {string} text
 * @param {{ byFqcn: Map<string, string>, byShort: Map<string, { fqcn: string, path: string }[]> }} index
 */
function indexTraitSource(rel, text, index) {
  const nsMatch = text.match(/\bnamespace\s+([^;]+);/);
  const traitMatch = text.match(/\btrait\s+(\w+)/);
  if (!nsMatch || !traitMatch) return;
  const fqcn = `${nsMatch[1].trim()}\\${traitMatch[1]}`;
  index.byFqcn.set(fqcn, rel);
  const short = traitMatch[1];
  const list = index.byShort.get(short) ?? [];
  if (!list.some((entry) => entry.path === rel)) {
    list.push({ fqcn, path: rel });
  }
  index.byShort.set(short, list);
}

/**
 * @param {string} rootAbs
 * @returns {{ byFqcn: Map<string, string>, byShort: Map<string, { fqcn: string, path: string }[]> }}
 */
function buildTraitIndex(rootAbs) {
  /** @type {{ byFqcn: Map<string, string>, byShort: Map<string, { fqcn: string, path: string }[]> }} */
  const index = { byFqcn: new Map(), byShort: new Map() };

  function walkTraits(dir) {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walkTraits(full);
        continue;
      }
      if (!entry.isFile() || path.extname(entry.name) !== ".php") continue;
      const rel = path.relative(repoRoot, full).split(path.sep).join("/");
      if (isExcluded(rel)) continue;
      indexTraitSource(rel, readFileSync(full, "utf8"), index);
    }
  }

  walkTraits(rootAbs);
  return index;
}

/**
 * Resolve a body trait name (short or FQCN) to a repo-relative PHP path.
 * @param {string} name
 * @param {string} fromNamespace
 * @param {{ byFqcn: Map<string, string>, byShort: Map<string, { fqcn: string, path: string }[]> }} index
 */
export function resolveTraitPath(name, fromNamespace, index) {
  const normalized = name.replace(/^\\/, "");
  if (normalized.includes("\\")) {
    return index.byFqcn.get(normalized) ?? null;
  }
  const sameNs = `${fromNamespace}\\${normalized}`;
  if (index.byFqcn.has(sameNs)) return index.byFqcn.get(sameNs) ?? null;
  const hits = index.byShort.get(normalized) ?? [];
  return hits.length === 1 ? hits[0].path : null;
}

/**
 * Transitive trait files used by a PHP source file (each path once).
 * @param {string} filePath repo-relative
 * @param {string} phpSource
 * @param {{ byFqcn: Map<string, string>, byShort: Map<string, { fqcn: string, path: string }[]> }} index
 * @param {Map<string, string>} fileTexts
 * @param {Set<string>} [visited]
 * @returns {Set<string>}
 */
export function collectTraitFiles(filePath, phpSource, index, fileTexts, visited = new Set()) {
  const nsMatch = phpSource.match(/\bnamespace\s+([^;]+);/);
  const fromNamespace = nsMatch ? nsMatch[1].trim() : "";
  for (const name of extractBodyTraitUses(phpSource)) {
    const traitPath = resolveTraitPath(name, fromNamespace, index);
    if (!traitPath || visited.has(traitPath)) continue;
    visited.add(traitPath);
    const traitText = fileTexts.get(traitPath);
    if (traitText === undefined) continue;
    collectTraitFiles(traitPath, traitText, index, fileTexts, visited);
  }
  return visited;
}

/**
 * For PHP under packages/api/app, add transitive trait file line counts to
 * each file that uses traits in its type body. Raw trait files stay at their
 * own line count (plus nested traits they use). Header imports do not count.
 * @param {Map<string, number>} rawCounts
 * @param {Map<string, string>} fileTexts
 * @param {string} [apiAppRootRel]
 * @returns {Map<string, number>}
 */
export function applyPhpTraitLineCounts(
  rawCounts,
  fileTexts,
  apiAppRootRel = "packages/api/app",
) {
  const apiAbs = path.join(repoRoot, apiAppRootRel);
  /** @type {{ byFqcn: Map<string, string>, byShort: Map<string, { fqcn: string, path: string }[]> }} */
  const index = statSync(apiAbs, { throwIfNoEntry: false })?.isDirectory()
    ? buildTraitIndex(apiAbs)
    : { byFqcn: new Map(), byShort: new Map() };
  for (const [rel, text] of fileTexts) {
    if (rel.startsWith(`${apiAppRootRel}/`) && rel.endsWith(".php")) {
      indexTraitSource(rel, text, index);
    }
  }
  /** @type {Map<string, number>} */
  const combined = new Map();
  for (const [filePath, own] of rawCounts) {
    if (!filePath.startsWith(`${apiAppRootRel}/`) || !filePath.endsWith(".php")) {
      combined.set(filePath, own);
      continue;
    }
    const text = fileTexts.get(filePath);
    if (text === undefined) {
      combined.set(filePath, own);
      continue;
    }
    const traits = collectTraitFiles(filePath, text, index, fileTexts);
    let total = own;
    for (const traitPath of traits) {
      total += rawCounts.get(traitPath) ?? countLines(fileTexts.get(traitPath) ?? "");
    }
    combined.set(filePath, total);
  }
  return combined;
}

function walk(dir, extensions, outCounts, outTexts) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, extensions, outCounts, outTexts);
      continue;
    }
    if (!entry.isFile()) continue;
    const ext = path.extname(entry.name);
    if (!extensions.has(ext)) continue;
    const rel = path.relative(repoRoot, full).split(path.sep).join("/");
    if (isExcluded(rel)) continue;
    const text = readFileSync(full, "utf8");
    outCounts.set(rel, countLines(text));
    if (outTexts && ext === ".php") outTexts.set(rel, text);
  }
}

function countedFiles(onlyRoot) {
  /** @type {Map<string, number>} */
  const rawCounts = new Map();
  /** @type {Map<string, string>} */
  const fileTexts = new Map();
  for (const tree of trees) {
    if (onlyRoot && tree.root !== onlyRoot) continue;
    const abs = path.join(repoRoot, tree.root);
    if (!statSync(abs, { throwIfNoEntry: false })?.isDirectory()) {
      throw new Error(`counted tree missing: ${tree.root}`);
    }
    walk(abs, tree.extensions, rawCounts, tree.root === "packages/api/app" ? fileTexts : null);
  }
  if (!onlyRoot || onlyRoot === "packages/api/app") {
    return applyPhpTraitLineCounts(rawCounts, fileTexts);
  }
  return rawCounts;
}

function parseBaseline(text) {
  /** @type {{ path: string, count: number, reason: string }[]} */
  const rows = [];
  const lines = text.split("\n");
  if (lines.length && lines[lines.length - 1] === "") lines.pop();
  for (const line of lines) {
    if (line.trim() === "" || line.startsWith("#")) continue;
    const [filePath, countRaw, ...reasonParts] = line.split("\t");
    const count = Number(countRaw);
    if (!filePath || !Number.isInteger(count)) {
      throw new Error(`malformed baseline row: ${line}`);
    }
    rows.push({ path: filePath, count, reason: reasonParts.join("\t") });
  }
  return rows;
}

function readBaseline() {
  return parseBaseline(readFileSync(baselinePath, "utf8"));
}

function formatBaseline(rows) {
  const sorted = [...rows].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return sorted.map((row) => `${row.path}\t${row.count}\t${row.reason}`).join("\n") + "\n";
}

/**
 * Pure check: compare counted files to baseline rows.
 * @param {Map<string, number>} counts
 * @param {{ path: string, count: number, reason: string }[]} rows
 * @param {{ ceiling?: number, onlyRoot?: string }} [options]
 * @returns {{ errors: string[] }}
 */
export function evaluate(counts, rows, { ceiling: limit = ceiling, onlyRoot } = {}) {
  const errors = [];
  const byPath = new Map(rows.map((row) => [row.path, row]));
  const seen = new Set();
  let previous = "";

  for (const row of rows) {
    if (seen.has(row.path)) errors.push(`${row.path}: duplicate baseline row`);
    seen.add(row.path);
    if (previous !== "" && row.path < previous) {
      errors.push(`${row.path}: baseline is not sorted`);
    }
    previous = row.path;
    if (row.reason.trim() === "") errors.push(`${row.path}: baseline reason is empty`);

    if (!isUnderCountedTree(row.path)) {
      errors.push(`${row.path}: baseline path is outside the counted trees`);
      continue;
    }

    if (onlyRoot && !row.path.startsWith(`${onlyRoot}/`)) continue;

    const actual = counts.get(row.path);
    if (actual === undefined) {
      errors.push(`${row.path}: baselined file is missing or excluded; run pnpm ratchet:update`);
      continue;
    }
    if (actual > row.count) {
      errors.push(`${row.path}: grew from ${row.count} to ${actual}`);
    }
    if (actual < row.count) {
      errors.push(`${row.path}: shrunk from ${row.count} to ${actual}; run pnpm ratchet:update`);
    }
    if (actual <= limit) {
      errors.push(`${row.path}: count ${actual} is at or under ${limit}; run pnpm ratchet:update`);
    }
  }

  for (const [filePath, actual] of counts) {
    if (actual <= limit) continue;
    if (!byPath.has(filePath)) {
      errors.push(`${filePath}: ${actual} lines and not on the baseline`);
    }
  }

  return { errors };
}

/**
 * Pure update: never raises a count and never adds a path.
 * @param {Map<string, number>} counts
 * @param {{ path: string, count: number, reason: string }[]} rows
 * @param {{ ceiling?: number }} [options]
 * @returns {{ rows: typeof rows, errors: string[] }}
 */
export function nextBaseline(counts, rows, { ceiling: limit = ceiling } = {}) {
  /** @type {typeof rows} */
  const next = [];
  /** @type {string[]} */
  const errors = [];
  for (const row of rows) {
    const actual = counts.get(row.path);
    if (actual === undefined || actual <= limit) continue;
    if (actual > row.count) {
      errors.push(`${row.path}: update refuses to raise ${row.count} to ${actual}`);
      continue;
    }
    next.push({ path: row.path, count: actual, reason: row.reason });
  }
  return { rows: next, errors };
}

/**
 * Pure rebaseline: rewrite existing rows to current counts (may raise).
 * Drops missing or <= ceiling rows. Never adds a path. Preserves reasons.
 * @param {Map<string, number>} counts
 * @param {{ path: string, count: number, reason: string }[]} rows
 * @param {{ ceiling?: number }} [options]
 * @returns {{ rows: typeof rows }}
 */
export function rebaselineRows(counts, rows, { ceiling: limit = ceiling } = {}) {
  /** @type {typeof rows} */
  const next = [];
  for (const row of rows) {
    const actual = counts.get(row.path);
    if (actual === undefined || actual <= limit) continue;
    next.push({ path: row.path, count: actual, reason: row.reason });
  }
  return { rows: next };
}

/**
 * Pure growth check: head may lower or delete rows, but must not raise a
 * count or introduce a path that was absent on the base baseline.
 * @param {{ path: string, count: number, reason: string }[]} baseRows
 * @param {{ path: string, count: number, reason: string }[]} headRows
 * @returns {string[]}
 */
export function baselineGrowthErrors(baseRows, headRows) {
  /** @type {string[]} */
  const errors = [];
  const baseByPath = new Map(baseRows.map((row) => [row.path, row.count]));
  for (const row of headRows) {
    if (!baseByPath.has(row.path)) {
      errors.push(`${row.path}: new baseline row`);
      continue;
    }
    const baseCount = baseByPath.get(row.path);
    if (row.count > baseCount) {
      errors.push(`${row.path}: baseline grew from ${baseCount} to ${row.count}`);
    }
  }
  return errors;
}

/** Drop pnpm's forwarded `--` so `pnpm run check:file-size-growth -- <ref>` works. */
export function growthBaseRefFromArgs(args) {
  return args.find((arg) => arg !== "--") ?? "";
}

/**
 * Classify `git show <ref>:tools/file-size-baseline.tsv` failure stderr.
 * Missing path on a known ref → empty baseline. Unknown/unfetched ref → hard fail.
 * @param {string} stderr
 * @returns {"missing-path" | "unknown-ref" | "other"}
 */
export function classifyGitShowBaselineStderr(stderr) {
  const text = String(stderr);
  if (/does not exist in /.test(text) || /exists on disk, but not in /.test(text)) {
    return "missing-path";
  }
  if (
    /invalid object name/i.test(text) ||
    /not a valid object name/i.test(text) ||
    /bad object/i.test(text) ||
    /unknown revision/i.test(text) ||
    /Needed a single revision/i.test(text) ||
    /ambiguous argument/i.test(text)
  ) {
    return "unknown-ref";
  }
  return "other";
}

function loadBaselineAtRef(baseRef) {
  try {
    const text = execFileSync("git", ["show", `${baseRef}:tools/file-size-baseline.tsv`], {
      encoding: "utf8",
      cwd: repoRoot,
      stdio: ["ignore", "pipe", "pipe"],
    });
    return parseBaseline(text);
  } catch (error) {
    const stderr = error?.stderr?.toString?.() ?? "";
    const kind = classifyGitShowBaselineStderr(stderr);
    // Missing path on the base ref (introducing PR) → empty baseline, not a hard fail.
    if (kind === "missing-path") {
      return [];
    }
    if (kind === "unknown-ref") {
      throw new Error(
        `Base ref '${baseRef}' is unknown or not fetched. Cannot compare file-size baseline growth.`,
      );
    }
    throw error;
  }
}

function checkDocs() {
  const missing = [];
  for (const rel of docPaths) {
    const text = readFileSync(path.join(repoRoot, rel), "utf8");
    if (!text.includes(FILE_SIZE_RULE)) missing.push(rel);
  }
  if (missing.length > 0) {
    console.error("File-size rule sentence missing from:\n");
    for (const rel of missing) console.error(`  - ${rel}`);
    process.exit(1);
  }
  console.log(`File-size rule sentence present in ${docPaths.length} docs.`);
}

function check(onlyRoot) {
  const counts = countedFiles(onlyRoot);
  const rows = readBaseline();
  const { errors } = evaluate(counts, rows, { ceiling, onlyRoot });

  if (errors.length > 0) {
    console.error(`File-size ratchet failed (${errors.length}):\n`);
    for (const error of errors) console.error(`  - ${error}`);
    process.exit(1);
  }
  console.log(`File-size ratchet passed${onlyRoot ? ` (${onlyRoot})` : ""}.`);
}

function update() {
  const counts = countedFiles();
  const rows = readBaseline();
  const { rows: next, errors } = nextBaseline(counts, rows, { ceiling });
  if (errors.length > 0) {
    for (const error of errors) console.error(error);
    process.exit(1);
  }
  writeFileSync(baselinePath, formatBaseline(next));
  console.log(`File-size baseline updated (${next.length} rows).`);
}

function rebaseline() {
  const counts = countedFiles();
  const rows = readBaseline();
  const { rows: next } = rebaselineRows(counts, rows, { ceiling });
  writeFileSync(baselinePath, formatBaseline(next));
  console.log(`File-size baseline rebaselined (${next.length} rows).`);
}

function checkGrowth(baseRef) {
  if (!baseRef) {
    console.error("usage: file-size-ratchet.mjs check-growth <baseRef>");
    process.exit(2);
  }
  let baseRows;
  try {
    baseRows = loadBaselineAtRef(baseRef);
  } catch (error) {
    console.error(error?.message ?? String(error));
    process.exit(1);
  }
  const headRows = readBaseline();
  const warnings = baselineGrowthErrors(baseRows, headRows);
  if (warnings.length > 0) {
    console.log(
      `File-size baseline growth versus ${baseRef} (${warnings.length}); code-owner review of tools/file-size-baseline.tsv is required:\n`,
    );
    for (const warning of warnings) {
      console.log(`::warning title=File-size baseline growth::${warning}`);
      console.log(`  - ${warning}`);
    }
    return;
  }
  console.log(`File-size baseline growth check passed versus ${baseRef}.`);
}

function main() {
  const [command, ...rest] = process.argv.slice(2).filter((arg) => arg !== "--");
  if (command === "check-docs") {
    checkDocs();
    return;
  }
  if (command === "check") {
    check(rest[0]);
    return;
  }
  if (command === "check-growth") {
    checkGrowth(growthBaseRefFromArgs(rest));
    return;
  }
  if (command === "update") {
    update();
    return;
  }
  if (command === "rebaseline") {
    rebaseline();
    return;
  }
  console.error(
    "usage: file-size-ratchet.mjs check [tree] | check-growth <baseRef> | update | rebaseline | check-docs",
  );
  process.exit(2);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
