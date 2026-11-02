#!/usr/bin/env node
/**
 * React hook structure ratchet for `packages/apps/src`.
 *
 * Measures every exported `use*` hook (function declaration, or `const`
 * arrow / function expression, also when exported through a local
 * `export { … }` list) in counted `.ts`/`.tsx` files. Exclusions are the
 * file-size ratchet's (tests, stories, mocks, fixtures, declarations,
 * `test-utils`).
 *
 * Two numbers per hook:
 * - lines: lines spanned by the function body, braces included;
 * - effects: `useEffect(` and `useLayoutEffect(` calls anywhere in the body,
 *   bare or as `React.useEffect(`. Layout effects count because the smell
 *   is about effects split by concern, and swapping `useEffect` for
 *   `useLayoutEffect` must not slip a hook past the limit.
 *
 * A hook is over a limit when lines > 200 or effects > 4.
 * Baseline rows are `path#hookName<TAB>lines<TAB>effects<TAB>reason`,
 * sorted by key. `check` fails when an over-limit hook is missing from the
 * baseline, when a baselined hook grew or shrank in either number without
 * an update, or when a row is within both limits or no longer exists.
 * `update` only lowers numbers and deletes rows. It never raises a number
 * and never adds a key. Raising the baseline requires code-owner review of
 * `tools/hook-size-baseline.tsv`.
 */
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { isExcluded } from "./file-size-ratchet.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const baselinePath = path.join(repoRoot, "tools/hook-size-baseline.tsv");
const countedRoot = "packages/apps/src";
const extensions = new Set([".ts", ".tsx"]);

export const LIMITS = Object.freeze({ lines: 200, effects: 4 });

export const HOOK_SIZE_RULE =
  "An exported `use*` hook in `packages/apps/src` with a body over 200 lines or more than 4 `useEffect` or `useLayoutEffect` calls is a merge block unless it is on the hook-size baseline. A baselined hook is a merge block when either number grows, or when it shrinks and the baseline was not lowered.";

const docPaths = [
  ".agents/skills/clean-code/smells.md",
  ".agents/skills/code-review/SKILL.md",
  ".agents/skills/developer/done-checklist.md",
  ".agents/skills/developer/SKILL.md",
  ".agents/POLICY.md",
];

const hookName = /^use[A-Z]/;
const effectCallees = new Set(["useEffect", "useLayoutEffect"]);

/** The workspace installs `typescript` under packages/apps, not the root. */
function loadTypeScript() {
  const require = createRequire(path.join(repoRoot, "packages/apps/package.json"));
  return require("typescript");
}

/** @type {typeof import("typescript") | undefined} */
let tsModule;
function ts() {
  tsModule ??= loadTypeScript();
  return tsModule;
}

export function hookKey(filePath, name) {
  return `${filePath}#${name}`;
}

/**
 * @param {import("typescript").Node} node
 */
function hasExportModifier(node) {
  const t = ts();
  const modifiers = t.canHaveModifiers(node) ? t.getModifiers(node) : undefined;
  return modifiers?.some((modifier) => modifier.kind === t.SyntaxKind.ExportKeyword) ?? false;
}

/**
 * Strip `( … )`, `as`, `satisfies` and `!` so `const useX = (() => {}) as T` counts.
 * @param {import("typescript").Expression} expression
 */
function unwrapExpression(expression) {
  const t = ts();
  let current = expression;
  while (
    t.isParenthesizedExpression(current) ||
    t.isAsExpression(current) ||
    t.isSatisfiesExpression(current) ||
    t.isNonNullExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}

/**
 * @param {import("typescript").Node} body
 */
function countEffects(body) {
  const t = ts();
  let effects = 0;
  /** @param {import("typescript").Node} node */
  function visit(node) {
    if (t.isCallExpression(node)) {
      const callee = node.expression;
      if (t.isIdentifier(callee) && effectCallees.has(callee.text)) effects++;
      else if (t.isPropertyAccessExpression(callee) && effectCallees.has(callee.name.text)) {
        effects++;
      }
    }
    t.forEachChild(node, visit);
  }
  visit(body);
  return effects;
}

/**
 * @param {import("typescript").SourceFile} sourceFile
 * @param {import("typescript").Node} body
 */
function bodyLines(sourceFile, body) {
  const start = sourceFile.getLineAndCharacterOfPosition(body.getStart(sourceFile)).line;
  const end = sourceFile.getLineAndCharacterOfPosition(body.getEnd()).line;
  return end - start + 1;
}

/**
 * Top-level hook candidates in one file, keyed by local name.
 * @param {import("typescript").SourceFile} sourceFile
 * @returns {{ local: Map<string, { body: import("typescript").Node, exported: boolean }>, exportedAs: Map<string, string[]> }}
 */
function collectCandidates(sourceFile) {
  const t = ts();
  /** @type {Map<string, { body: import("typescript").Node, exported: boolean }>} */
  const local = new Map();
  /** @type {Map<string, string[]>} local name -> exported names from `export { a as b }` */
  const exportedAs = new Map();

  for (const statement of sourceFile.statements) {
    if (t.isFunctionDeclaration(statement) && statement.name && statement.body) {
      local.set(statement.name.text, {
        body: statement.body,
        exported: hasExportModifier(statement),
      });
      continue;
    }
    if (t.isVariableStatement(statement)) {
      const exported = hasExportModifier(statement);
      for (const declaration of statement.declarationList.declarations) {
        if (!t.isIdentifier(declaration.name) || !declaration.initializer) continue;
        const init = unwrapExpression(declaration.initializer);
        if (t.isArrowFunction(init) || t.isFunctionExpression(init)) {
          local.set(declaration.name.text, { body: init.body, exported });
        }
      }
      continue;
    }
    if (
      t.isExportDeclaration(statement) &&
      !statement.moduleSpecifier &&
      !statement.isTypeOnly &&
      statement.exportClause &&
      t.isNamedExports(statement.exportClause)
    ) {
      for (const element of statement.exportClause.elements) {
        if (element.isTypeOnly) continue;
        const localName = (element.propertyName ?? element.name).text;
        const list = exportedAs.get(localName) ?? [];
        list.push(element.name.text);
        exportedAs.set(localName, list);
      }
    }
  }
  return { local, exportedAs };
}

/**
 * Measure exported `use*` hooks in one source text.
 * @param {string} text
 * @param {string} [fileName]
 * @returns {{ name: string, lines: number, effects: number }[]}
 */
export function measureHooks(text, fileName = "hook.tsx") {
  const t = ts();
  const kind = fileName.endsWith(".tsx") ? t.ScriptKind.TSX : t.ScriptKind.TS;
  const sourceFile = t.createSourceFile(fileName, text, t.ScriptTarget.Latest, true, kind);
  const { local, exportedAs } = collectCandidates(sourceFile);

  /** @type {Map<string, { name: string, lines: number, effects: number }>} */
  const byName = new Map();
  for (const [localName, candidate] of local) {
    const names = new Set(exportedAs.get(localName) ?? []);
    if (candidate.exported) names.add(localName);
    for (const name of names) {
      if (!hookName.test(name)) continue;
      byName.set(name, {
        name,
        lines: bodyLines(sourceFile, candidate.body),
        effects: countEffects(candidate.body),
      });
    }
  }
  return [...byName.values()].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

/**
 * @param {{ lines: number, effects: number }} metrics
 * @param {{ lines: number, effects: number }} [limits]
 */
export function isOverLimit(metrics, limits = LIMITS) {
  return metrics.lines > limits.lines || metrics.effects > limits.effects;
}

function walk(dir, out) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, out);
      continue;
    }
    if (!entry.isFile() || !extensions.has(path.extname(entry.name))) continue;
    const rel = path.relative(repoRoot, full).split(path.sep).join("/");
    if (isExcluded(rel)) continue;
    const text = readFileSync(full, "utf8");
    // Cheap pre-filter: no `use[A-Z]` token means no hook to parse.
    if (!/\buse[A-Z]/.test(text)) continue;
    for (const hook of measureHooks(text, rel)) {
      out.set(hookKey(rel, hook.name), { lines: hook.lines, effects: hook.effects });
    }
  }
}

/** @returns {Map<string, { lines: number, effects: number }>} */
function measuredHooks() {
  const abs = path.join(repoRoot, countedRoot);
  if (!statSync(abs, { throwIfNoEntry: false })?.isDirectory()) {
    throw new Error(`counted tree missing: ${countedRoot}`);
  }
  /** @type {Map<string, { lines: number, effects: number }>} */
  const out = new Map();
  walk(abs, out);
  return out;
}

/**
 * @param {string} text
 * @returns {{ key: string, lines: number, effects: number, reason: string }[]}
 */
export function parseBaseline(text) {
  /** @type {{ key: string, lines: number, effects: number, reason: string }[]} */
  const rows = [];
  const lines = text.split("\n");
  if (lines.length && lines[lines.length - 1] === "") lines.pop();
  for (const line of lines) {
    if (line.trim() === "" || line.startsWith("#")) continue;
    const [key, linesRaw, effectsRaw, ...reasonParts] = line.split("\t");
    const lineCount = Number(linesRaw);
    const effects = Number(effectsRaw);
    if (!key || !key.includes("#") || !Number.isInteger(lineCount) || !Number.isInteger(effects)) {
      throw new Error(`malformed baseline row: ${line}`);
    }
    rows.push({ key, lines: lineCount, effects, reason: reasonParts.join("\t") });
  }
  return rows;
}

/**
 * @param {{ key: string, lines: number, effects: number, reason: string }[]} rows
 */
export function formatBaseline(rows) {
  const sorted = [...rows].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  return (
    sorted.map((row) => `${row.key}\t${row.lines}\t${row.effects}\t${row.reason}`).join("\n") + "\n"
  );
}

function readBaseline() {
  return parseBaseline(readFileSync(baselinePath, "utf8"));
}

/**
 * @param {{ lines: number, effects: number }} metrics
 */
function describe(metrics) {
  return `${metrics.lines} lines, ${metrics.effects} effects`;
}

/**
 * Pure check: compare measured hooks to baseline rows.
 * @param {Map<string, { lines: number, effects: number }>} measured
 * @param {{ key: string, lines: number, effects: number, reason: string }[]} rows
 * @param {{ limits?: { lines: number, effects: number } }} [options]
 * @returns {{ errors: string[] }}
 */
export function evaluate(measured, rows, { limits = LIMITS } = {}) {
  /** @type {string[]} */
  const errors = [];
  const byKey = new Map(rows.map((row) => [row.key, row]));
  const seen = new Set();
  let previous = "";

  for (const row of rows) {
    if (seen.has(row.key)) errors.push(`${row.key}: duplicate baseline row`);
    seen.add(row.key);
    if (previous !== "" && row.key < previous) errors.push(`${row.key}: baseline is not sorted`);
    previous = row.key;
    if (row.reason.trim() === "") errors.push(`${row.key}: baseline reason is empty`);
    if (!row.key.startsWith(`${countedRoot}/`)) {
      errors.push(`${row.key}: baseline key is outside ${countedRoot}`);
      continue;
    }

    const actual = measured.get(row.key);
    if (actual === undefined) {
      errors.push(
        `${row.key}: baselined hook is missing or excluded; run pnpm hook-ratchet:update`,
      );
      continue;
    }
    for (const metric of /** @type {const} */ (["lines", "effects"])) {
      const label = metric === "lines" ? "body lines" : "effect calls";
      if (actual[metric] > row[metric]) {
        errors.push(`${row.key}: ${label} grew from ${row[metric]} to ${actual[metric]}`);
      } else if (actual[metric] < row[metric]) {
        errors.push(
          `${row.key}: ${label} shrunk from ${row[metric]} to ${actual[metric]}; run pnpm hook-ratchet:update`,
        );
      }
    }
    if (!isOverLimit(actual, limits)) {
      errors.push(
        `${row.key}: ${describe(actual)} is within the limits (${limits.lines} lines, ${limits.effects} effects); run pnpm hook-ratchet:update`,
      );
    }
  }

  for (const [key, actual] of measured) {
    if (!isOverLimit(actual, limits) || byKey.has(key)) continue;
    errors.push(
      `${key}: ${describe(actual)} is over the limits (${limits.lines} lines, ${limits.effects} effects) and not on the baseline`,
    );
  }

  return { errors };
}

/**
 * Pure update: lowers numbers and drops rows; never raises and never adds.
 * @param {Map<string, { lines: number, effects: number }>} measured
 * @param {{ key: string, lines: number, effects: number, reason: string }[]} rows
 * @param {{ limits?: { lines: number, effects: number } }} [options]
 * @returns {{ rows: typeof rows, errors: string[] }}
 */
export function nextBaseline(measured, rows, { limits = LIMITS } = {}) {
  /** @type {typeof rows} */
  const next = [];
  /** @type {string[]} */
  const errors = [];
  for (const row of rows) {
    const actual = measured.get(row.key);
    if (actual === undefined || !isOverLimit(actual, limits)) continue;
    const raised = [];
    if (actual.lines > row.lines) raised.push(`body lines ${row.lines} to ${actual.lines}`);
    if (actual.effects > row.effects) {
      raised.push(`effect calls ${row.effects} to ${actual.effects}`);
    }
    if (raised.length > 0) {
      errors.push(`${row.key}: update refuses to raise ${raised.join(" and ")}`);
      next.push(row);
      continue;
    }
    next.push({ key: row.key, lines: actual.lines, effects: actual.effects, reason: row.reason });
  }
  return { rows: next, errors };
}

function checkDocs() {
  const missing = [];
  for (const rel of docPaths) {
    const text = readFileSync(path.join(repoRoot, rel), "utf8");
    if (!text.includes(HOOK_SIZE_RULE)) missing.push(rel);
  }
  if (missing.length > 0) {
    console.error("Hook-size rule sentence missing from:\n");
    for (const rel of missing) console.error(`  - ${rel}`);
    process.exit(1);
  }
  console.log(`Hook-size rule sentence present in ${docPaths.length} docs.`);
}

function check() {
  const measured = measuredHooks();
  const { errors } = evaluate(measured, readBaseline());
  if (errors.length > 0) {
    console.error(`Hook-size ratchet failed (${errors.length}):\n`);
    for (const error of errors) console.error(`  - ${error}`);
    console.error(
      "\nSplit the hook, or lower the baseline with pnpm hook-ratchet:update. Raising tools/hook-size-baseline.tsv needs code-owner review.",
    );
    process.exit(1);
  }
  console.log(`Hook-size ratchet passed (${measured.size} exported hooks measured).`);
}

function update() {
  const { rows: next, errors } = nextBaseline(measuredHooks(), readBaseline());
  if (errors.length > 0) {
    for (const error of errors) console.error(error);
    process.exit(1);
  }
  writeFileSync(baselinePath, formatBaseline(next));
  console.log(`Hook-size baseline updated (${next.length} rows).`);
}

function main() {
  const [command] = process.argv.slice(2).filter((arg) => arg !== "--");
  if (command === "check") return check();
  if (command === "update") return update();
  if (command === "check-docs") return checkDocs();
  console.error("usage: hook-size-ratchet.mjs check | update | check-docs");
  process.exit(2);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
