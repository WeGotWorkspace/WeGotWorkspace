#!/usr/bin/env node
// Line delta of a pull request, split into source, test and other (#1633).
// A signal for reviewers and agents, never a gate: the CI job fails only when
// the diff itself cannot be read.
//
// Usage: node tools/github/pr-line-delta.mjs <base-sha> <head-sha>
// Prints a Markdown report. Both commits and their merge base must be present.
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const COMMENT_MARKER = "<!-- pr-line-delta -->";

const KINDS = ["source", "test", "other"];
const AREAS = ["packages/api", "packages/apps", "other"];

const OTHER_PATTERNS = [
  /(^|\/)pnpm-lock\.yaml$/,
  /(^|\/)composer\.lock$/,
  /^packages\/openapi-types\/generated\//,
  /^\.agents\//,
  /^docs\//,
  /\.md$/,
];

const TEST_PATTERNS = [
  /\.(test|spec|stories)\.[^/]+$/,
  /(^|\/)__tests__\//,
  /(^|\/)__snapshots__\//,
  /(^|\/)stories\//,
  /^packages\/api\/tests\//,
  /(^|\/)e2e\//,
  /(^|\/)(__)?fixtures(__)?\//,
  /Test\.php$/,
];

/**
 * @param {string} file repository-relative path
 * @returns {"source" | "test" | "other"}
 */
export function classify(file) {
  if (OTHER_PATTERNS.some((pattern) => pattern.test(file))) return "other";
  if (TEST_PATTERNS.some((pattern) => pattern.test(file))) return "test";
  if (file.startsWith("packages/") || file.startsWith("tools/"))
    return "source";
  return "other";
}

/** @param {string} file */
export function areaOf(file) {
  if (file.startsWith("packages/api/")) return "packages/api";
  if (file.startsWith("packages/apps/")) return "packages/apps";
  return "other";
}

/**
 * Parses `git diff --numstat -z -M`. A rename carries an empty path field and
 * then the old and new paths; it is counted under the new path. Binary files
 * ("-") count as zero lines.
 * @param {string} raw
 * @returns {{ path: string, added: number, deleted: number }[]}
 */
export function parseNumstat(raw) {
  const fields = raw.split("\0");
  const rows = [];
  for (let i = 0; i < fields.length; i++) {
    const entry = fields[i];
    if (entry === "") continue;
    const [added, deleted, file] = entry.split("\t");
    let target = file;
    if (file === "") {
      target = fields[i + 2];
      i += 2;
    }
    if (target === undefined)
      throw new Error(`Unreadable numstat entry: ${entry}`);
    rows.push({
      path: target,
      added: toCount(added),
      deleted: toCount(deleted),
    });
  }
  return rows;
}

function toCount(value) {
  return value === "-" ? 0 : Number.parseInt(value, 10);
}

/**
 * @param {{ path: string, added: number, deleted: number }[]} rows
 */
export function summarize(rows) {
  const empty = () =>
    Object.fromEntries(KINDS.map((kind) => [kind, { added: 0, deleted: 0 }]));
  const total = empty();
  const byArea = Object.fromEntries(AREAS.map((area) => [area, empty()]));
  for (const { path: file, added, deleted } of rows) {
    const kind = classify(file);
    for (const bucket of [total[kind], byArea[areaOf(file)][kind]]) {
      bucket.added += added;
      bucket.deleted += deleted;
    }
  }
  return { total, byArea };
}

function signed(value) {
  if (value > 0) return `+${value}`;
  if (value < 0) return `−${Math.abs(value)}`;
  return "0";
}

function net(bucket) {
  return bucket.added - bucket.deleted;
}

/**
 * @param {ReturnType<typeof summarize>} summary
 * @returns {string}
 */
export function renderMarkdown({ total, byArea }) {
  const sourceNet = net(total.source);
  const testNet = net(total.test);
  const lines = [
    COMMENT_MARKER,
    "## Line changes",
    "",
    `**Source net ${signed(sourceNet)}**, test net ${signed(testNet)}${ratio(sourceNet, testNet)}.`,
    "",
    "| Kind | Added | Removed | Net |",
    "|------|------:|--------:|----:|",
    ...KINDS.map(
      (kind) =>
        `| ${kind} | +${total[kind].added} | −${total[kind].deleted} | ${signed(net(total[kind]))} |`,
    ),
    "",
    "| Area | Source net | Test net | Other net |",
    "|------|-----------:|---------:|----------:|",
    ...AREAS.filter((area) =>
      KINDS.some(
        (kind) => byArea[area][kind].added + byArea[area][kind].deleted > 0,
      ),
    ).map(
      (area) =>
        `| ${area} | ${KINDS.map((kind) => signed(net(byArea[area][kind]))).join(" | ")} |`,
    ),
    "",
    "Source is code under `packages/` and `tools/`; test is tests, stories, e2e and fixtures; other is lockfiles, generated types, docs and everything else. A signal only, never a failing check.",
    "",
  ];
  return lines.join("\n");
}

function ratio(sourceNet, testNet) {
  if (testNet === 0) return "";
  return ` (source/test ${(sourceNet / testNet).toFixed(2)})`;
}

/**
 * @param {string} base
 * @param {string} head
 */
export function lineDelta(base, head) {
  const raw = execFileSync(
    "git",
    ["diff", "--numstat", "-z", "-M", `${base}...${head}`],
    {
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    },
  );
  return summarize(parseNumstat(raw));
}

function main() {
  const [base, head] = process.argv.slice(2);
  if (!base || !head) {
    console.error("usage: pr-line-delta.mjs <base-sha> <head-sha>");
    process.exit(2);
  }
  process.stdout.write(renderMarkdown(lineDelta(base, head)));
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main();
}
