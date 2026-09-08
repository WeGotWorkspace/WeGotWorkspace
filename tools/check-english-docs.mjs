#!/usr/bin/env node

/**
 * Fail CI when agent/docs markdown prose contains high-confidence Dutch.
 * Does not scan source code, locale files, or fenced/inline code (fixtures,
 * nl-NL samples, and the ❌ BAD examples in the English-only rule).
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");

const SCAN_ROOTS = [
  ".agents",
  "docs",
  "packages/api/docs",
  "packages/apps/docs",
  ".github/ISSUE_TEMPLATE",
  ".github/pull_request_template.md",
  ".cursor/rules",
  "AGENTS.md",
  "CLAUDE.md",
  "CONTRIBUTING.md",
  "GOVERNANCE.md",
];

const SCAN_EXTENSIONS = new Set([".md", ".mdc", ".yml", ".yaml"]);

const SKIP_DIR_NAMES = new Set([
  "node_modules",
  "vendor",
  "dist",
  "coverage",
  ".git",
]);

/**
 * High-confidence Dutch function/content words that are not English words.
 * Intentionally omits tot/van/de/en/of/met/in/op/te/kan/dan/als (false positives).
 */
const DUTCH_WORD =
  /\b(?:het|een|niet|wordt|worden|moet|deze|wanneer|waarom|waarbij|waardoor|hierbij|hierdoor|hiervoor|hiermee|daarbij|daardoor|daarom|daarmee|namelijk|alleen|altijd|nooit|zodat|zodra|terwijl|tenzij|indien|onderstaande|bovenstaande|hieronder|hierboven|gebruiker(?:s)?|documentatie|specificatie|samenvatting|uitwerking|functionaliteit|instellingen|moeten|kunnen|volgende|bijvoorbeeld|eigenlijk|aangezien|geen)\b/gi;

/** @param {string} dir @param {string[]} results */
function walkFiles(dir, results = []) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return results;
  }

  for (const entry of entries) {
    if (SKIP_DIR_NAMES.has(entry)) {
      continue;
    }
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      walkFiles(full, results);
    } else if (SCAN_EXTENSIONS.has(extname(entry))) {
      results.push(full);
    }
  }
  return results;
}

/** @param {string} content */
function stripMarkdownCode(content) {
  const withoutFences = content.replace(/```[\s\S]*?```/g, "\n");
  return withoutFences.replace(/`[^`\n]+`/g, " ");
}

/**
 * @param {string} content
 * @param {string} relativePath
 * @returns {{ line: number, snippet: string, word: string, file: string }[]}
 */
function findDutchInProse(content, relativePath = "") {
  const prose = stripMarkdownCode(content);
  const hits = [];
  const lines = prose.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    DUTCH_WORD.lastIndex = 0;
    const match = DUTCH_WORD.exec(line);
    if (match) {
      hits.push({
        line: i + 1,
        snippet: line.trim().slice(0, 160),
        word: match[0],
        file: relativePath,
      });
    }
  }
  return hits;
}

function collectScanFiles() {
  /** @type {string[]} */
  const files = [];
  for (const root of SCAN_ROOTS) {
    const full = resolve(repoRoot, root);
    try {
      const stat = statSync(full);
      if (stat.isDirectory()) {
        walkFiles(full, files);
      } else if (stat.isFile()) {
        files.push(full);
      }
    } catch {
      // Optional path (e.g. .cursor/rules on a clone without Cursor files).
    }
  }
  return [...new Set(files)];
}

function main() {
  const files = collectScanFiles();
  /** @type {{ line: number, snippet: string, word: string, file: string }[]} */
  const hits = [];

  for (const filePath of files) {
    const relativePath = relative(repoRoot, filePath);
    const content = readFileSync(filePath, "utf8");
    hits.push(...findDutchInProse(content, relativePath));
  }

  if (hits.length > 0) {
    console.error(
      "English-only check failed: Dutch prose in specs, plans, docs, or GitHub templates.\n" +
        "Write these artifacts in English even when the user prompt is Dutch.\n" +
        "See .agents/skills/developer/english-only.md\n",
    );
    for (const hit of hits) {
      console.error(`  ${hit.file}:${hit.line}  (“${hit.word}”)  ${hit.snippet}`);
    }
    process.exit(1);
  }

  console.log(
    `English-only check passed (${files.length} files, prose only; code fences skipped).`,
  );
}

main();
