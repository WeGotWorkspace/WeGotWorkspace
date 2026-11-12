#!/usr/bin/env node
/**
 * Which coverage jobs a CI run needs (#1629). Prints `api=<bool>` and
 * `apps=<bool>` lines for $GITHUB_OUTPUT.
 *
 * - push (main): both. The baseline proposal needs both reports.
 * - merge_group, and pull requests labeled run-full-ci: the side whose files
 *   changed between the base and head commit. A change outside both packages
 *   (CI, tools, lockfiles) runs both; only `.agents/` and `docs/` are skipped.
 * - a pull request labeled run-apps-coverage: the apps side at least.
 * - any other pull request: neither. Coverage stays off the PR fast path; the
 *   merge queue catches a drop before it reaches main.
 *
 * Usage: EVENT=… LABELS='["…"]' BASE_SHA=… HEAD_SHA=… node tools/coverage-scope.mjs
 * BASE_SHA and HEAD_SHA must both be fetched; a failed diff fails the step.
 */
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const NO_COVERAGE_EFFECT = [".agents/", "docs/"];

/**
 * @param {string[]} paths repository-relative changed paths
 * @returns {{ api: boolean, apps: boolean }}
 */
export function scopeForPaths(paths) {
  const relevant = paths.filter(
    (file) => !NO_COVERAGE_EFFECT.some((prefix) => file.startsWith(prefix)),
  );
  return {
    api: relevant.some((file) => !file.startsWith("packages/apps/")),
    apps: relevant.some((file) => !file.startsWith("packages/api/")),
  };
}

/**
 * @param {{ event: string, labels: string[], changedPaths: () => string[] }} input
 * @returns {{ api: boolean, apps: boolean }}
 */
export function coverageScope({ event, labels, changedPaths }) {
  if (event === "push") return { api: true, apps: true };
  if (event === "merge_group") return scopeForPaths(changedPaths());
  if (event !== "pull_request") return { api: false, apps: false };

  const appsLabel = labels.includes("run-apps-coverage");
  if (!labels.includes("run-full-ci")) return { api: false, apps: appsLabel };
  const changed = scopeForPaths(changedPaths());
  return { api: changed.api, apps: changed.apps || appsLabel };
}

export function gitChangedPaths(base, head) {
  if (!base || !head) {
    throw new Error("BASE_SHA and HEAD_SHA are required for a diff");
  }
  // --no-renames lists a move as delete plus add, so the side that lost the
  // file is selected. Two-dot: the tree difference. Both commits are fetched; their merge
  // base does not have to be.
  const out = execFileSync(
    "git",
    ["diff", "--name-only", "--no-renames", base, head],
    {
      encoding: "utf8",
    },
  );
  return out.split("\n").filter(Boolean);
}

function main() {
  const labels = JSON.parse(process.env.LABELS || "[]");
  const scope = coverageScope({
    event: process.env.EVENT ?? "",
    labels: Array.isArray(labels) ? labels : [],
    changedPaths: () =>
      gitChangedPaths(process.env.BASE_SHA, process.env.HEAD_SHA),
  });
  process.stdout.write(`api=${scope.api}\napps=${scope.apps}\n`);
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main();
}
