#!/usr/bin/env node
/**
 * Import-direction report for `packages/apps/src` (#1632, #1638).
 *
 *   pnpm --filter @wgw/apps run lint:boundaries          table per edge
 *   pnpm --filter @wgw/apps run lint:boundaries --json   same data as JSON
 *
 * Runs only the `wgw-boundaries/import-boundaries` rule from eslint.config.js
 * in `reportAll` mode, so it sees every cross-module import in the files the
 * rule checks (tests excluded), then classifies each one with the rule's own
 * `violation()`. Prints, per (from → to) edge that breaks the direction rules,
 * the number of importing files and import lines, and the module pairs that
 * import each other in both directions where one side is an app package
 * (the #1638 cycle count; allowlisted directions count as a side).
 *
 * The totals match the `warn` count of the rule in a normal lint run.
 *
 * Baseline (#1642 candidate 4, "warn mode with a baseline"):
 *
 *   lint:boundaries --check    exit 1 when an edge is new or has more files
 *                              than scripts/import-boundaries-baseline.json,
 *                              or when a two-way pair is not in its list
 *   lint:boundaries --update   lower the baseline to today's counts and drop
 *                              pairs that are gone; it never raises a count,
 *                              never adds an edge and never adds a pair
 *
 * An edge that shrank only prints a notice, so a move in #1638 does not have
 * to touch the baseline in the same pull request. Raising a count or adding
 * an edge means editing the JSON by hand, which a reviewer sees.
 *
 * The pair list closes the gap the edge counts leave: when an app package
 * starts importing a primitive that already imports it (an allowed, downward
 * import), no violating edge is new or grows, yet the two now import each
 * other. Every two-way pair must be on the list, so a new cycle fails CI.
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { ESLint } from "eslint";

import { violation } from "./eslint-import-boundaries.mjs";

const RULE_ID = "wgw-boundaries/import-boundaries";
const EDGE = /^Import edge: (\S+) \((\w+)\) -> (\S+) \((\w+)\)\.$/;

const appsRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const baselinePath = path.join(appsRoot, "scripts/import-boundaries-baseline.json");

const BASELINE_DOC = "See .agents/skills/apps-ui/import-boundaries.md.";

/**
 * @typedef {{ from: string, fromLayer: string, to: string, toLayer: string,
 *   kind: "upward" | "crossCore" | null, files: Set<string>, lines: number }} Edge
 */

/** @param {import("eslint").ESLint.LintResult[]} results */
export function collectEdges(results) {
  /** @type {Map<string, Edge>} */
  const edges = new Map();
  for (const result of results) {
    for (const message of result.messages) {
      if (message.ruleId !== RULE_ID) continue;
      const match = EDGE.exec(message.message);
      if (!match) throw new Error(`Unexpected message from ${RULE_ID}: ${message.message}`);
      const [, from, fromLayer, to, toLayer] = match;
      const key = `${from} -> ${to}`;
      let edge = edges.get(key);
      if (!edge) {
        edge = {
          from,
          fromLayer,
          to,
          toLayer,
          kind: violation(from, to),
          files: new Set(),
          lines: 0,
        };
        edges.set(key, edge);
      }
      edge.files.add(path.relative(appsRoot, result.filePath));
      edge.lines += 1;
    }
  }
  return edges;
}

/** @param {Map<string, Edge>} edges */
export function summarize(edges) {
  const violations = [...edges.values()]
    .filter((edge) => edge.kind)
    .sort(
      (a, b) =>
        b.files.size - a.files.size || a.from.localeCompare(b.from) || a.to.localeCompare(b.to),
    );
  const files = new Set(violations.flatMap((edge) => [...edge.files]));
  // Distinct importing files per layer pair: one file importing three app
  // packages counts once under "base -> core".
  /** @type {Map<string, Set<string>>} */
  const filesByLayers = new Map();
  for (const edge of violations) {
    const key = `${edge.fromLayer} -> ${edge.toLayer}`;
    const set = filesByLayers.get(key) ?? new Set();
    for (const file of edge.files) set.add(file);
    filesByLayers.set(key, set);
  }
  // #1638 counts cycles that involve an app package. `lib` is left out: every
  // `lib` → higher import is already an edge above.
  const twoWay = [];
  for (const edge of edges.values()) {
    const back = edges.get(`${edge.to} -> ${edge.from}`);
    const involvesCore = edge.fromLayer === "core" || edge.toLayer === "core";
    const involvesBase = edge.fromLayer === "base" || edge.toLayer === "base";
    if (back && edge.from < edge.to && involvesCore && !involvesBase) {
      twoWay.push({ a: edge.from, b: edge.to, aToB: edge.files.size, bToA: back.files.size });
    }
  }
  twoWay.sort((x, y) => x.a.localeCompare(y.a) || x.b.localeCompare(y.b));
  return {
    warnings: violations.reduce((sum, edge) => sum + edge.lines, 0),
    files: files.size,
    layerPairs: [...filesByLayers]
      .map(([layers, set]) => ({ layers, files: set.size }))
      .sort((a, b) => b.files - a.files || a.layers.localeCompare(b.layers)),
    edges: violations.map((edge) => ({
      from: edge.from,
      to: edge.to,
      kind: edge.kind,
      layers: `${edge.fromLayer} -> ${edge.toLayer}`,
      files: edge.files.size,
      lines: edge.lines,
    })),
    twoWayPairs: twoWay,
  };
}

/** @param {ReturnType<typeof summarize>} summary */
export function formatSummary(summary) {
  const out = [];
  out.push(`Import-direction warnings: ${summary.warnings} import lines in ${summary.files} files`);
  out.push("");
  out.push("files  layers (distinct importing files)");
  for (const pair of summary.layerPairs) {
    out.push(`${String(pair.files).padStart(5)}  ${pair.layers}`);
  }
  out.push("");
  out.push("files  lines  edge  (layers, kind)");
  for (const edge of summary.edges) {
    out.push(
      `${String(edge.files).padStart(5)}  ${String(edge.lines).padStart(5)}  ${edge.from} -> ${edge.to}  (${edge.layers}, ${edge.kind})`,
    );
  }
  out.push("");
  out.push(
    `Two-way pairs with an app package (files importing the other side): ${summary.twoWayPairs.length}`,
  );
  for (const pair of summary.twoWayPairs) {
    out.push(`  ${pair.a} ${pair.aToB} <-> ${pair.bToA} ${pair.b}`);
  }
  return out.join("\n");
}

/** @param {number} count */
const files = (count) => `${count} ${count === 1 ? "file" : "files"}`;

/** @param {{ a: string, b: string }} pair */
export const pairKey = (pair) => `${pair.a} <-> ${pair.b}`;

/**
 * @typedef {{ edges: Record<string, number>, twoWayPairs: string[] }} Baseline
 *   files per "from -> to" edge, and the "a <-> b" pairs (a < b) that may
 *   import each other
 */

/**
 * @param {Pick<ReturnType<typeof summarize>, "edges" | "twoWayPairs">} summary
 * @param {Baseline} baseline
 */
export function compareToBaseline(summary, baseline) {
  const failures = [];
  const notices = [];
  const seen = new Set();
  for (const edge of summary.edges) {
    const key = `${edge.from} -> ${edge.to}`;
    seen.add(key);
    const allowed = baseline.edges[key];
    if (allowed === undefined) {
      failures.push(`new edge ${key} (${files(edge.files)}). ${BASELINE_DOC}`);
    } else if (edge.files > allowed) {
      failures.push(`${key} grew from ${allowed} to ${files(edge.files)}. ${BASELINE_DOC}`);
    } else if (edge.files < allowed) {
      notices.push(`${key} dropped from ${allowed} to ${files(edge.files)}`);
    }
  }
  for (const key of Object.keys(baseline.edges)) {
    if (!seen.has(key)) notices.push(`${key} is gone`);
  }
  const knownPairs = new Set(baseline.twoWayPairs);
  const seenPairs = new Set();
  for (const pair of summary.twoWayPairs) {
    const key = pairKey(pair);
    seenPairs.add(key);
    if (!knownPairs.has(key)) {
      failures.push(
        `new two-way pair ${key}: ${pair.a} imports ${pair.b} in ${files(pair.aToB)} and ${pair.b} imports ${pair.a} in ${files(pair.bToA)}. ${BASELINE_DOC}`,
      );
    }
  }
  for (const key of baseline.twoWayPairs) {
    if (!seenPairs.has(key)) notices.push(`two-way pair ${key} is gone`);
  }
  return { failures, notices };
}

/**
 * Lower every count to today's value and drop edges and pairs that are gone.
 * Never raises a count, never adds an edge, never adds a pair.
 *
 * @param {Pick<ReturnType<typeof summarize>, "edges" | "twoWayPairs">} summary
 * @param {Baseline} baseline
 * @returns {Baseline}
 */
export function lowerBaseline(summary, baseline) {
  const current = new Map(summary.edges.map((edge) => [`${edge.from} -> ${edge.to}`, edge.files]));
  /** @type {Record<string, number>} */
  const edges = {};
  for (const key of Object.keys(baseline.edges).sort()) {
    const count = current.get(key);
    if (count !== undefined) edges[key] = Math.min(count, baseline.edges[key]);
  }
  const currentPairs = new Set(summary.twoWayPairs.map(pairKey));
  const twoWayPairs = baseline.twoWayPairs.filter((key) => currentPairs.has(key)).sort();
  return { edges, twoWayPairs };
}

/** @returns {Baseline} */
function readBaseline() {
  const { edges, twoWayPairs } = JSON.parse(readFileSync(baselinePath, "utf8"));
  return { edges, twoWayPairs: twoWayPairs ?? [] };
}

async function main() {
  const eslint = new ESLint({
    cwd: appsRoot,
    ruleFilter: ({ ruleId }) => ruleId === RULE_ID,
    overrideConfig: {
      files: ["src/**/*.{ts,tsx}"],
      ignores: ["src/**/*.test.{ts,tsx}", "src/**/__tests__/**"],
      rules: { [RULE_ID]: ["warn", { reportAll: true }] },
    },
  });
  const results = await eslint.lintFiles(["src/**/*.{ts,tsx}"]);
  const summary = summarize(collectEdges(results));
  if (process.argv.includes("--check")) {
    const { failures, notices } = compareToBaseline(summary, readBaseline());
    for (const notice of notices) {
      process.stdout.write(
        `Notice: ${notice}; pnpm --filter @wgw/apps run lint:boundaries --update can lower the baseline\n`,
      );
    }
    for (const failure of failures) process.stderr.write(`Import boundaries: ${failure}\n`);
    if (failures.length > 0) process.exit(1);
    process.stdout.write(
      `Import-boundary baseline passed (${summary.warnings} import lines in ${summary.files} files).\n`,
    );
    return;
  }
  if (process.argv.includes("--update")) {
    const next = lowerBaseline(summary, readBaseline());
    writeFileSync(baselinePath, `${JSON.stringify(next, null, 2)}\n`);
    process.stdout.write(
      `Wrote ${Object.keys(next.edges).length} edges and ${next.twoWayPairs.length} two-way pairs to ${path.relative(appsRoot, baselinePath)}\n`,
    );
    return;
  }
  if (process.argv.includes("--json")) {
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  } else {
    process.stdout.write(`${formatSummary(summary)}\n`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
