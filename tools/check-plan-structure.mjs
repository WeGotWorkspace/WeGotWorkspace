#!/usr/bin/env node
/**
 * Diff-scoped plan structure check for .agents/specs plan.md and spec.md.
 *
 * Changed plan.md files must have Invariants and Open decisions. Invariants
 * set to None are allowed only when every file in the diff is under docs/
 * or .agents/. Chunk sections reject deferral markers. What exists bullets
 * need a link, path:, or a nested quote or code block. Disappeared ## / ###
 * headings must be named under Removed since previous revision.
 */

import { execFileSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const DEFERRAL_MARKERS = /\b(?:TBD|TODO|FIXME)\b|\?\?\?/;
const DECIDE_LATER = /decide later/i;

/** @param {string} prose */
function hasDeferral(prose) {
  return DEFERRAL_MARKERS.test(prose) || DECIDE_LATER.test(prose);
}

/** @param {string} text */
function stripFences(text) {
  const out = [];
  let fence = false;
  for (const line of text.split(/\r?\n/)) {
    if (/^\s*```/.test(line)) {
      fence = !fence;
      continue;
    }
    if (!fence) out.push(line);
  }
  return out.join("\n");
}

/** @param {string} text @returns {string[]} */
export function atxHeadings(text) {
  const headings = [];
  let fence = false;
  for (const line of text.split(/\r?\n/)) {
    if (/^\s*```/.test(line)) {
      fence = !fence;
      continue;
    }
    if (fence) continue;
    const match = /^(#{2,3})\s+(.+?)\s*#*\s*$/.exec(line);
    if (match) headings.push(match[2].trim());
  }
  return headings;
}

/** @param {string} text @param {string} title @returns {string | null} */
export function sectionBody(text, title) {
  const lines = text.split(/\r?\n/);
  let fence = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*```/.test(line)) {
      fence = !fence;
      continue;
    }
    if (fence) continue;
    const match = /^(#{2,6})\s+(.+?)\s*#*\s*$/.exec(line);
    if (!match || match[2].trim() !== title) continue;
    const level = match[1].length;
    const body = [];
    let bodyFence = false;
    for (let j = i + 1; j < lines.length; j++) {
      if (/^\s*```/.test(lines[j])) {
        bodyFence = !bodyFence;
        body.push(lines[j]);
        continue;
      }
      if (!bodyFence) {
        const heading = /^(#{1,6})\s+/.exec(lines[j]);
        if (heading && heading[1].length <= level) break;
      }
      body.push(lines[j]);
    }
    return body.join("\n");
  }
  return null;
}

/** @param {string | null} body */
export function isNoneValue(body) {
  if (body == null) return false;
  return body.split(/\r?\n/).some((line) => /^\s*None\b/.test(line));
}

/** @param {string} text @returns {{ title: string, body: string }[]} */
export function chunkBodies(text) {
  const lines = text.split(/\r?\n/);
  /** @type {{ title: string, body: string }[]} */
  const chunks = [];
  let fence = false;
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*```/.test(lines[i])) {
      fence = !fence;
      continue;
    }
    if (fence) continue;
    const match = /^(###)\s+(.+?)\s*#*\s*$/.exec(lines[i]);
    if (!match || !/^Chunk\b/i.test(match[2].trim())) continue;
    const body = [];
    let bodyFence = false;
    for (let j = i + 1; j < lines.length; j++) {
      if (/^\s*```/.test(lines[j])) {
        bodyFence = !bodyFence;
        body.push(lines[j]);
        continue;
      }
      if (!bodyFence && /^(#{1,3})\s+/.test(lines[j])) break;
      body.push(lines[j]);
    }
    chunks.push({ title: match[2].trim(), body: body.join("\n") });
  }
  return chunks;
}

/**
 * @param {string} body
 * @returns {{ line: string, nested: string[] }[]}
 */
export function topLevelBullets(body) {
  const lines = body.split(/\r?\n/);
  /** @type {{ line: string, nested: string[] }[]} */
  const bullets = [];
  for (let i = 0; i < lines.length; i++) {
    if (!/^[-*]\s+/.test(lines[i])) continue;
    const nested = [];
    let j = i + 1;
    for (; j < lines.length; j++) {
      if (/^[-*]\s+/.test(lines[j]) || /^#{1,6}\s+/.test(lines[j])) break;
      nested.push(lines[j]);
    }
    bullets.push({ line: lines[i], nested });
    i = j - 1;
  }
  return bullets;
}

/** @param {string} blob */
function hasRealPathCitation(blob) {
  const pattern = /path:\s*(\S+)/g;
  for (const match of blob.matchAll(pattern)) {
    if (!match[1].includes("path/to/")) return true;
  }
  return false;
}

/** @param {{ line: string, nested: string[] }} bullet */
export function bulletHasCitation(bullet) {
  const blob = [bullet.line, ...bullet.nested].join("\n");
  if (/\]\(/.test(blob) || /\]\[/.test(blob)) return true;
  if (hasRealPathCitation(blob)) return true;
  if (bullet.nested.some((line) => /^\s*>/.test(line) || /^\s*```/.test(line))) return true;
  return false;
}

/** @param {string} filePath */
export function isDocsOrAgents(filePath) {
  const normalized = filePath.replace(/\\/g, "/").replace(/^\.\//, "");
  return (
    normalized === "docs" ||
    normalized.startsWith("docs/") ||
    normalized === ".agents" ||
    normalized.startsWith(".agents/")
  );
}

/**
 * @param {string} oldHeading
 * @param {string | null} removedBody
 * @param {string[]} tipHeadings
 * @returns {{ ok: true } | { ok: false, reason: string }}
 */
export function accountForHeading(oldHeading, removedBody, tipHeadings) {
  if (removedBody == null) {
    return { ok: false, reason: "missing ## Removed since previous revision" };
  }
  const marker = `renamed ${oldHeading} → `;
  for (const line of removedBody.split(/\r?\n/)) {
    const at = line.indexOf(marker);
    if (at === -1) continue;
    let next = line.slice(at + marker.length).trim().split("—")[0].trim();
    next = next.split(/ because\b/i)[0].trim();
    if (tipHeadings.includes(next)) return { ok: true };
    return { ok: false, reason: `renamed target "${next}" is not a heading on the tip` };
  }
  for (const line of removedBody.split(/\r?\n/)) {
    if (!line.includes(oldHeading)) continue;
    const extra = line
      .split(oldHeading)
      .join(" ")
      .replace(/^[\s>*-]+/, "")
      .trim();
    if (/\bbecause\b/i.test(extra)) return { ok: true };
    if (/[—–]/.test(extra) && extra.replace(/[—–]/g, "").trim().length > 0) return { ok: true };
    if (/\s-\s+\S/.test(line)) return { ok: true };
  }
  return { ok: false, reason: "not named with a why" };
}

/**
 * @param {{ plans: { path: string, before: string | null, after: string }[], diffPaths: string[] }} input
 * @returns {string[]}
 */
export function evaluatePlans({ plans, diffPaths }) {
  /** @type {string[]} */
  const errors = [];
  const paths = diffPaths.map((filePath) => filePath.replace(/\\/g, "/"));

  for (const plan of plans) {
    const rel = plan.path.replace(/\\/g, "/");
    if (rel.includes(".agents/specs/_template/")) continue;
    const isPlan = rel.includes(".agents/specs/") && rel.endsWith("/plan.md");
    const isSpec = rel.includes(".agents/specs/") && rel.endsWith("/spec.md");
    if (!isPlan && !isSpec) continue;

    if (isPlan) {
      const invariants = sectionBody(plan.after, "Invariants");
      if (invariants == null) {
        errors.push(`${rel}: missing ## Invariants`);
      } else if (isNoneValue(invariants)) {
        const outside = paths.filter((filePath) => !isDocsOrAgents(filePath));
        if (outside.length > 0) {
          errors.push(
            `${rel}: Invariants is None, but the diff touches ${outside.join(", ")}`,
          );
        }
      }

      if (sectionBody(plan.after, "Open decisions") == null) {
        errors.push(`${rel}: missing ## Open decisions`);
      }

      for (const chunk of chunkBodies(plan.after)) {
        const prose = stripFences(chunk.body);
        if (hasDeferral(prose)) {
          errors.push(`${rel}: deferral marker in ${chunk.title}`);
        }
      }

      const whatExists = sectionBody(plan.after, "What exists");
      if (whatExists != null) {
        for (const bullet of topLevelBullets(whatExists)) {
          if (!bulletHasCitation(bullet)) {
            errors.push(`${rel}: What exists bullet has no citation: ${bullet.line.trim()}`);
          }
        }
      }
    }

    if (plan.before == null) continue;
    const beforeHeadings = atxHeadings(plan.before);
    const afterHeadings = atxHeadings(plan.after);
    const removedBody = sectionBody(plan.after, "Removed since previous revision");
    for (const heading of beforeHeadings) {
      if (afterHeadings.includes(heading)) continue;
      const accounted = accountForHeading(heading, removedBody, afterHeadings);
      if (!accounted.ok) {
        errors.push(`${rel}: heading "${heading}" disappeared (${accounted.reason})`);
      }
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

/**
 * CI with no merge base must fail. A shallow checkout has no origin/main,
 * and comparing to HEAD reports an empty diff as a pass.
 *
 * @param {string} base
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {string | null}
 */
export function ciBaseError(base, env = process.env) {
  if (base === "HEAD" && env.CI) {
    return "Plan structure check could not resolve a merge base. CI must fetch the base branch (fetch-depth: 0, or git fetch origin main). Refusing to report a pass against HEAD.";
  }
  return null;
}

/** @param {string} root */
export function resolveBase(root) {
  for (const ref of ["origin/main", "main"]) {
    try {
      git(["rev-parse", "--verify", "--quiet", ref], root);
      return git(["merge-base", "HEAD", ref], root).trim();
    } catch {
      continue;
    }
  }
  return "HEAD";
}

/** @param {string} root @param {string} base */
function changedPaths(root, base) {
  const tracked = git(["diff", "--name-only", "--diff-filter=ACMR", base], root)
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  let untracked = [];
  try {
    untracked = git(["ls-files", "--others", "--exclude-standard"], root)
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
  } catch {
    untracked = [];
  }
  return [...new Set([...tracked, ...untracked])];
}

/** @param {string} root @param {string} base @param {string} rel @returns {string | null} */
function fileAtBase(root, base, rel) {
  try {
    return git(["show", `${base}:${rel}`], root);
  } catch {
    return null;
  }
}

function main() {
  const base = resolveBase(repoRoot);
  const baseError = ciBaseError(base);
  if (baseError) {
    console.error(baseError);
    process.exit(1);
  }
  const diffPaths = changedPaths(repoRoot, base);
  const specPaths = diffPaths.filter(
    (rel) =>
      rel.includes(".agents/specs/") &&
      (rel.endsWith("/plan.md") || rel.endsWith("/spec.md")),
  );

  /** @type {{ path: string, before: string | null, after: string }[]} */
  const plans = [];
  for (const rel of specPaths) {
    const absolute = path.join(repoRoot, rel);
    if (!existsSync(absolute)) continue;
    plans.push({
      path: rel,
      before: fileAtBase(repoRoot, base, rel),
      after: readFileSync(absolute, "utf8"),
    });
  }

  const errors = evaluatePlans({ plans, diffPaths });
  if (errors.length > 0) {
    console.error(`Plan structure check failed (${errors.length}):\n`);
    for (const error of errors) console.error(`  - ${error}`);
    process.exit(1);
  }
  console.log(
    `Plan structure check passed (${plans.length} changed plan or spec file${plans.length === 1 ? "" : "s"}).`,
  );
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) {
  main();
}
