#!/usr/bin/env node
/**
 * 400-line source ratchet.
 *
 * Baseline rows are `path<TAB>count<TAB>reason`, sorted by path.
 * `check` fails when a counted file over 400 is missing, grew, shrank
 * without an update, or is still listed at or under 400.
 * `update` only lowers a stored count or deletes a row that is now <= 400.
 * It never raises a count and never adds a path.
 */
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const baselinePath = path.join(repoRoot, "tools/file-size-baseline.tsv");
const ceiling = 400;

export const FILE_SIZE_RULE =
  "A new counted source file over 400 lines is a merge block unless its baseline entry carries an approved reason. A baselined file is a merge block when its line count grows, or when it shrinks and the stored integer was not lowered.";

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

function walk(dir, extensions, out) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, extensions, out);
      continue;
    }
    if (!entry.isFile()) continue;
    const ext = path.extname(entry.name);
    if (!extensions.has(ext)) continue;
    const rel = path.relative(repoRoot, full).split(path.sep).join("/");
    if (isExcluded(rel)) continue;
    const text = readFileSync(full, "utf8");
    out.set(rel, countLines(text));
  }
}

function countedFiles(onlyRoot) {
  const counts = new Map();
  for (const tree of trees) {
    if (onlyRoot && tree.root !== onlyRoot) continue;
    const abs = path.join(repoRoot, tree.root);
    if (!statSync(abs, { throwIfNoEntry: false })?.isDirectory()) {
      throw new Error(`counted tree missing: ${tree.root}`);
    }
    walk(abs, tree.extensions, counts);
  }
  return counts;
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
  const byPath = new Map(rows.map((row) => [row.path, row]));
  const errors = [];

  const seen = new Set();
  let previous = "";
  for (const row of rows) {
    if (onlyRoot && !row.path.startsWith(`${onlyRoot}/`)) continue;
    if (seen.has(row.path)) errors.push(`${row.path}: duplicate baseline row`);
    seen.add(row.path);
    if (row.path < previous) errors.push(`${row.path}: baseline is not sorted`);
    previous = row.path;
    if (row.reason.trim() === "") errors.push(`${row.path}: baseline reason is empty`);
    const actual = counts.get(row.path);
    if (actual === undefined) {
      errors.push(`${row.path}: baselined file is missing or excluded`);
      continue;
    }
    if (actual > row.count) errors.push(`${row.path}: grew from ${row.count} to ${actual}`);
    if (actual < row.count) {
      errors.push(`${row.path}: shrunk from ${row.count} to ${actual}; run pnpm ratchet:update`);
    }
    if (actual <= ceiling) {
      errors.push(`${row.path}: count ${actual} is at or under ${ceiling}; run pnpm ratchet:update`);
    }
  }

  for (const [filePath, actual] of counts) {
    if (actual <= ceiling) continue;
    if (!byPath.has(filePath)) {
      errors.push(`${filePath}: ${actual} lines and not on the baseline`);
    }
  }

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
  /** @type {typeof rows} */
  const next = [];
  for (const row of rows) {
    const actual = counts.get(row.path);
    if (actual === undefined || actual <= ceiling) continue;
    if (actual > row.count) {
      console.error(`${row.path}: update refuses to raise ${row.count} to ${actual}`);
      process.exit(1);
    }
    next.push({ path: row.path, count: actual, reason: row.reason });
  }
  const before = new Set(rows.map((row) => row.path));
  for (const row of next) {
    if (!before.has(row.path)) {
      console.error(`${row.path}: update refuses to add a path`);
      process.exit(1);
    }
  }
  writeFileSync(baselinePath, formatBaseline(next));
  console.log(`File-size baseline updated (${next.length} rows).`);
}

function main() {
  const [command, arg] = process.argv.slice(2);
  if (command === "check-docs") {
    checkDocs();
    return;
  }
  if (command === "check") {
    check(arg);
    return;
  }
  if (command === "update") {
    update();
    return;
  }
  console.error("usage: file-size-ratchet.mjs check [tree] | update | check-docs");
  process.exit(2);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
