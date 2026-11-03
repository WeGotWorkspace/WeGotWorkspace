#!/usr/bin/env node
/**
 * Diff-scoped check: a new architecture doc for an Epic ships with its spec.
 *
 * When the diff adds a file under docs/architecture/ that ends in .md and
 * names an Epic (`Epic: #N`, `**Epic:** [#N](…)`, `Epic [#N](…)`, `Epic #N`),
 * `.agents/specs/N-<slug>/spec.md` must exist and its first line must be
 * `Source: #N (body-hash: <8 hex>)`. The first Epic the doc names is its
 * Epic; later mentions are background. Docs already on the base branch are
 * not checked, and a doc that names no Epic is not checked.
 */

import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { ciBaseError, resolveBase } from "./check-plan-structure.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const SPECS_DIR = ".agents/specs";
const EPIC_REFERENCE = /\bEpic\b[*_]*:?[*_]*\s*\[?#(\d+)\b/;

/** @param {string} filePath */
export function isArchitectureDoc(filePath) {
  const normalized = filePath.replace(/\\/g, "/").replace(/^\.\//, "");
  return normalized.startsWith("docs/architecture/") && normalized.endsWith(".md");
}

/**
 * The first Epic number named outside fenced code, or null.
 *
 * @param {string} text
 * @returns {number | null}
 */
export function epicOf(text) {
  let fence = false;
  for (const line of text.split(/\r?\n/)) {
    if (/^\s*```/.test(line)) {
      fence = !fence;
      continue;
    }
    if (fence) continue;
    const match = EPIC_REFERENCE.exec(line);
    if (match) return Number(match[1]);
  }
  return null;
}

/**
 * @param {number} epic
 * @param {string} firstLine
 */
export function isSourceHeader(epic, firstLine) {
  return new RegExp(`^Source: #${epic} \\(body-hash: [0-9a-f]{8}\\)`).test(firstLine);
}

/**
 * @param {{
 *   addedDocs: { path: string, text: string }[],
 *   specs: { dir: string, firstLine: string | null }[],
 * }} input
 * @returns {string[]}
 */
export function evaluateArchitectureDocs({ addedDocs, specs }) {
  /** @type {string[]} */
  const errors = [];
  for (const doc of addedDocs) {
    if (!isArchitectureDoc(doc.path)) continue;
    const epic = epicOf(doc.text);
    if (epic == null) continue;

    const matches = specs.filter((spec) => spec.dir.startsWith(`${epic}-`));
    if (matches.length === 0) {
      errors.push(
        `${doc.path}: names Epic #${epic}, but ${SPECS_DIR}/${epic}-<slug>/spec.md is missing. Load .agents/skills/plan-feature/ and add spec.md, plan.md and tasks.md in the same PR.`,
      );
      continue;
    }
    const headed = matches.some(
      (spec) => spec.firstLine != null && isSourceHeader(epic, spec.firstLine),
    );
    if (!headed) {
      const dirs = matches.map((spec) => `${SPECS_DIR}/${spec.dir}/spec.md`).join(", ");
      errors.push(
        `${doc.path}: names Epic #${epic}, but ${dirs} does not start with "Source: #${epic} (body-hash: <8 hex>)".`,
      );
    }
  }
  return errors;
}

/** @param {string[]} args @param {string} cwd */
function git(args, cwd) {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

/** @param {string} output */
function lines(output) {
  return output
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

/** @param {string} root @param {string} base */
function addedPaths(root, base) {
  const tracked = lines(git(["diff", "--name-only", "--diff-filter=A", base], root));
  let untracked = [];
  try {
    untracked = lines(git(["ls-files", "--others", "--exclude-standard"], root));
  } catch {
    untracked = [];
  }
  return [...new Set([...tracked, ...untracked])];
}

/** @param {string} root */
function readSpecs(root) {
  const specsRoot = path.join(root, SPECS_DIR);
  if (!existsSync(specsRoot)) return [];
  return readdirSync(specsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && /^\d+-/.test(entry.name))
    .map((entry) => {
      const specPath = path.join(specsRoot, entry.name, "spec.md");
      const firstLine = existsSync(specPath)
        ? readFileSync(specPath, "utf8").split(/\r?\n/)[0]
        : null;
      return { dir: entry.name, firstLine };
    });
}

function main() {
  const base = resolveBase(repoRoot);
  const baseError = ciBaseError(base);
  if (baseError) {
    console.error(baseError.replace("Plan structure check", "Architecture spec check"));
    process.exit(1);
  }

  const addedDocs = addedPaths(repoRoot, base)
    .filter(isArchitectureDoc)
    .filter((rel) => existsSync(path.join(repoRoot, rel)))
    .map((rel) => ({ path: rel, text: readFileSync(path.join(repoRoot, rel), "utf8") }));

  const errors = evaluateArchitectureDocs({ addedDocs, specs: readSpecs(repoRoot) });
  if (errors.length > 0) {
    console.error(`Architecture spec check failed (${errors.length}):\n`);
    for (const error of errors) console.error(`  - ${error}`);
    process.exit(1);
  }
  console.log(
    `Architecture spec check passed (${addedDocs.length} new architecture doc${addedDocs.length === 1 ? "" : "s"}).`,
  );
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) {
  main();
}
