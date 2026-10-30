#!/usr/bin/env node
// Runs the cheap repo-wide quality checks after a push to main and reports a
// failure on one GitHub issue. Used by .github/workflows/main-quality-guard.yml.
//
// Merges that skip the pull request and merge-queue CI (for example a merge
// from a private fork) can break a ratchet on main. The merge queue then fails
// for every pull request until someone notices (#1776). This makes the
// breakage visible within minutes. It never blocks a push and never changes a
// baseline.
//
//   node tools/github/main-quality-guard.mjs run <results.json>
//   node tools/github/main-quality-guard.mjs report <results.json> [--dry-run] [--open-issue <n|none>]
//
// `run` runs CHECKS, writes their results to <results.json>, and exits 1 when
// one failed. `report` reads that file. On a failure it opens the issue titled
// ISSUE_TITLE, or comments on it when it is open. When every check passes and
// the issue is open, it comments once that main passes again. A missing
// results file means a setup step failed before the checks ran; that is
// reported as a failure too. `--dry-run` prints the action and the text
// instead of writing to GitHub; with `--open-issue` it makes no gh call.
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ISSUE_TITLE = "main fails a quality check after a push";
export const ISSUE_LABELS = ["type:bug", "area:platform"];
export const FAIL_MARKER = "<!-- main-quality-guard:fail -->";
export const PASS_MARKER = "<!-- main-quality-guard:pass -->";

/** Repo-wide checks a merge without CI can break, cheapest first. */
export const CHECKS = [
  { id: "file-size", command: "pnpm run check:file-size" },
  { id: "hook-size", command: "pnpm run check:hook-size" },
  { id: "duplicate-code", command: "pnpm run check:duplicate-code" },
  { id: "agent-docs", command: "pnpm run check:agent-docs" },
  { id: "api-types", command: "pnpm run check:api-types" },
  { id: "greenfield-guard", command: "composer --working-dir packages/api lint" },
  { id: "pint", command: "composer --working-dir packages/api format:check" },
  { id: "phpstan", command: "composer --working-dir packages/api phpstan" },
];

const MAX_EXCERPT_LINES = 30;
const MAX_LINE_LENGTH = 200;
const MAX_STORED_LINES = 400;
// GitHub rejects an issue body or comment over 65536 characters.
const MAX_BODY_LENGTH = 60000;

const ANSI_PATTERN = /\x1b\[[0-9;?]*[ -/]*[@-~]/g;
const URL_PATTERN = /\bhttps?:\/\/[^\s<>()"'`]+/gi;
// GitHub tokens, in case a tool ever prints one. The checks run without secrets.
const TOKEN_PATTERN = /\b(?:gh[pousr]_|github_pat_)[A-Za-z0-9_]{20,}/g;
// pnpm echoes the script it runs: "> @wgw/workspace@ check:file-size …".
const PNPM_ECHO_PATTERN = /^> /;

/**
 * The last lines of a check's output, safe to post: no colour codes, no URLs
 * (a log can name a live host), no tokens, no pnpm script echo.
 *
 * @param {string} output
 * @param {number} [maxLines]
 * @returns {{ lines: string[], omitted: number }}
 */
export function failureExcerpt(output, maxLines = MAX_EXCERPT_LINES) {
  const cleaned = String(output ?? "")
    .replace(ANSI_PATTERN, "")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) =>
      line
        .replace(URL_PATTERN, "<url removed>")
        .replace(TOKEN_PATTERN, "<token removed>")
        .trimEnd(),
    )
    .filter((line) => !PNPM_ECHO_PATTERN.test(line));

  const lines = [];
  for (const line of cleaned) {
    if (line === "" && (lines.length === 0 || lines.at(-1) === "")) continue;
    lines.push(line.length > MAX_LINE_LENGTH ? `${line.slice(0, MAX_LINE_LENGTH)} …` : line);
  }
  while (lines.at(-1) === "") lines.pop();

  const omitted = Math.max(0, lines.length - maxLines);
  return { lines: lines.slice(omitted), omitted };
}

/** A code fence longer than any backtick run inside `text`. */
function fenceFor(text) {
  const longest = Math.max(0, ...(text.match(/`+/g) ?? []).map((run) => run.length));
  return "`".repeat(Math.max(3, longest + 1));
}

/** @param {{ id: string, command: string, exitCode: number | null, output: string }} result */
function failureSection(result) {
  const { lines, omitted } = failureExcerpt(result.output);
  const text = lines.join("\n") || "(no output)";
  const fence = fenceFor(text);
  const parts = [
    `### \`${result.id}\` failed`,
    "",
    `\`${result.command}\` exited with code ${result.exitCode ?? "unknown"}.`,
    "",
  ];
  if (omitted > 0) parts.push(`Last ${lines.length} lines; ${omitted} earlier lines are in the run log.`, "");
  parts.push(`${fence}text`, text, fence);
  return parts.join("\n");
}

/**
 * @param {{ results: Array<{ id: string, command: string, ok: boolean, exitCode: number | null, output: string }> | null }} input
 * @returns {string}
 */
function failureDetails({ results }) {
  if (results === null) {
    return [
      "### Setup failed",
      "",
      "A setup step (for example installing dependencies) failed before the checks ran. See the run log.",
    ].join("\n");
  }
  return results
    .filter((result) => !result.ok)
    .map(failureSection)
    .join("\n\n");
}

/** @param {{ sha: string, runUrl: string }} input */
function commitLine({ sha, runUrl }) {
  return `Commit: \`${sha}\` · [workflow run](${runUrl})`;
}

/** @param {string} body */
function capLength(body) {
  if (body.length <= MAX_BODY_LENGTH) return body;
  return `${body.slice(0, MAX_BODY_LENGTH)}\n\n… (cut off; the full output is in the run log)`;
}

/**
 * @param {{ results: Array<object> | null, sha: string, runUrl: string }} input
 * @returns {string}
 */
export function issueBody({ results, sha, runUrl }) {
  return capLength(
    [
      FAIL_MARKER,
      "## Summary",
      "",
      "**What:** The main branch fails one of its automatic quality checks after a push.",
      "**Who notices:** Developers with an open pull request, because the merge queue fails on the same check. Users see nothing directly.",
      "**If we wait:** New fixes and features cannot be merged until the check passes again.",
      "",
      "## Details",
      "",
      commitLine({ sha, runUrl }),
      "",
      "A change reached `main` without passing this check, for example a merge that skipped the pull request and merge-queue CI.",
      "",
      failureDetails({ results }),
      "",
      "## What should happen instead?",
      "",
      "The checks pass on `main`. Fix the cause in a pull request. Raising a baseline needs code-owner review (`.github/CODEOWNERS`).",
      "",
      "Opened by `.github/workflows/main-quality-guard.yml`. It comments here on every later push while `main` still fails, and once when `main` passes again. Close this issue by hand once the fix is merged.",
    ].join("\n"),
  );
}

/** @param {{ results: Array<object> | null, sha: string, runUrl: string }} input */
export function failureComment({ results, sha, runUrl }) {
  return capLength(
    [FAIL_MARKER, "`main` still fails after a push.", "", commitLine({ sha, runUrl }), "", failureDetails({ results })].join(
      "\n",
    ),
  );
}

/** @param {{ sha: string, runUrl: string }} input */
export function passComment({ sha, runUrl }) {
  return [
    PASS_MARKER,
    "`main` passes every check of the main quality guard again.",
    "",
    commitLine({ sha, runUrl }),
    "",
    "Close this issue once the fix is confirmed.",
  ].join("\n");
}

/**
 * The body of the latest comment this guard wrote, or null. Comments without
 * a marker (people replying on the issue) are skipped.
 *
 * @param {Array<string | null | undefined>} bodies comment bodies, oldest first
 * @returns {string | null}
 */
export function lastGuardComment(bodies) {
  return bodies.findLast((body) => body?.includes(FAIL_MARKER) || body?.includes(PASS_MARKER)) ?? null;
}

/**
 * What to do on GitHub. A pass is reported once: not again while the latest
 * guard comment on the issue is already a pass comment.
 *
 * @param {{ failed: boolean, openIssue: number | null, lastGuardCommentBody?: string | null }} input
 * @returns {"create" | "comment-failure" | "comment-pass" | "none"}
 */
export function decideAction({ failed, openIssue, lastGuardCommentBody = null }) {
  if (failed) return openIssue === null ? "create" : "comment-failure";
  if (openIssue === null) return "none";
  return lastGuardCommentBody?.includes(PASS_MARKER) ? "none" : "comment-pass";
}

/**
 * @param {Array<{ number: number, title: string }>} issues
 * @returns {number | null} the oldest open issue with exactly ISSUE_TITLE
 */
export function pickOpenIssue(issues) {
  const numbers = issues.filter((issue) => issue.title === ISSUE_TITLE).map((issue) => issue.number);
  return numbers.length === 0 ? null : Math.min(...numbers);
}

/** @param {string} url @returns {number} */
export function issueNumberFromUrl(url) {
  const match = /\/issues\/(\d+)\s*$/.exec(url.trim());
  if (!match) throw new Error(`gh issue create printed no issue URL: ${url}`);
  return Number(match[1]);
}

/**
 * Runs each check with stdout and stderr merged. Never throws on a failing
 * check; the caller decides the exit code.
 *
 * @param {Array<{ id: string, command: string }>} checks
 * @param {{ cwd?: string, log?: (line: string) => void }} [options]
 */
export function runChecks(checks, { cwd = process.cwd(), log = (line) => process.stdout.write(`${line}\n`) } = {}) {
  return checks.map(({ id, command }) => {
    log(`::group::${id}: ${command}`);
    const started = Date.now();
    const child = spawnSync("bash", ["-o", "pipefail", "-c", `${command} 2>&1`], {
      cwd,
      encoding: "utf8",
      maxBuffer: 256 * 1024 * 1024,
      env: { ...process.env, NO_COLOR: "1" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const output = `${child.stdout ?? ""}${child.stderr ?? ""}${child.error ? `\n${child.error.message}` : ""}`;
    const exitCode = child.status;
    const ok = exitCode === 0;
    log(output.trimEnd());
    log("::endgroup::");
    const seconds = ((Date.now() - started) / 1000).toFixed(1);
    log(ok ? `${id}: passed (${seconds}s)` : `::error title=${id} failed::${command} exited with code ${exitCode}`);
    const stored = output.split("\n").slice(-MAX_STORED_LINES).join("\n");
    return { id, command, ok, exitCode, output: stored };
  });
}

/** @param {string[]} args @param {string} [input] */
function gh(args, input) {
  return execFileSync("gh", args, {
    encoding: "utf8",
    input,
    stdio: [input === undefined ? "ignore" : "pipe", "pipe", "inherit"],
  });
}

// Search narrows the list; pickOpenIssue still requires the exact title.
function findOpenIssue() {
  const search = `in:title "${ISSUE_TITLE}"`;
  const issues = JSON.parse(
    gh(["issue", "list", "--state", "open", "--search", search, "--limit", "100", "--json", "number,title"]),
  );
  return pickOpenIssue(issues);
}

/** @param {number} number */
function guardCommentBody(number) {
  const { comments } = JSON.parse(gh(["issue", "view", String(number), "--json", "comments"]));
  return lastGuardComment(comments.map((comment) => comment.body));
}

function runContext(env = process.env) {
  const server = env.GITHUB_SERVER_URL ?? "https://github.com";
  const repository = env.GITHUB_REPOSITORY ?? "WeGotWorkspace/WeGotWorkspace";
  const runId = env.GITHUB_RUN_ID ?? "0";
  return { sha: env.GITHUB_SHA ?? "unknown", runUrl: `${server}/${repository}/actions/runs/${runId}` };
}

/** @param {string[]} argv */
function parseReportArgs(argv) {
  const [file, ...rest] = argv;
  if (!file) throw new Error("usage: report <results.json> [--dry-run] [--open-issue <n|none>]");
  const options = { file, dryRun: false, openIssue: undefined };
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === "--dry-run") options.dryRun = true;
    else if (rest[i] === "--open-issue") {
      const value = rest[++i];
      options.openIssue = value === "none" ? null : Number(value);
    } else throw new Error(`unknown argument: ${rest[i]}`);
  }
  return options;
}

/** @param {string[]} argv */
function report(argv) {
  const options = parseReportArgs(argv);
  const results = existsSync(options.file) ? JSON.parse(readFileSync(options.file, "utf8")) : null;
  const failed = results === null || results.some((result) => !result.ok);
  const context = { results, ...runContext() };

  const openIssue = options.openIssue !== undefined ? options.openIssue : findOpenIssue();
  const guardComment = !failed && openIssue !== null && options.openIssue === undefined ? guardCommentBody(openIssue) : null;
  const action = decideAction({ failed, openIssue, lastGuardCommentBody: guardComment });

  const body =
    action === "create"
      ? issueBody(context)
      : action === "comment-failure"
        ? failureComment(context)
        : action === "comment-pass"
          ? passComment(context)
          : null;

  console.log(`main-quality-guard: ${failed ? "failed" : "passed"}; open issue: ${openIssue ?? "none"}; action: ${action}`);
  if (options.dryRun) {
    if (body) console.log(`\n${action === "create" ? `Title: ${ISSUE_TITLE}\nLabels: ${ISSUE_LABELS.join(", ")}\n\n` : ""}${body}`);
    return;
  }

  if (action === "create") {
    const labels = ISSUE_LABELS.flatMap((label) => ["--label", label]);
    const url = gh(["issue", "create", "--title", ISSUE_TITLE, ...labels, "--body-file", "-"], body);
    const number = issueNumberFromUrl(url);
    console.log(`Opened #${number}`);
    try {
      gh(["api", "-X", "PATCH", `repos/{owner}/{repo}/issues/${number}`, "-f", "type=Bug", "--silent"]);
    } catch {
      console.log(`::warning::Could not set the Bug issue type on #${number}; the type:bug label is set.`);
    }
  } else if (action === "comment-failure" || action === "comment-pass") {
    gh(["issue", "comment", String(openIssue), "--body-file", "-"], body);
    console.log(`Commented on #${openIssue}`);
  }
}

/** @param {string[]} argv */
function run(argv) {
  const [file] = argv;
  if (!file) throw new Error("usage: run <results.json>");
  const results = runChecks(CHECKS);
  writeFileSync(file, `${JSON.stringify(results, null, 2)}\n`);
  const failed = results.filter((result) => !result.ok).map((result) => result.id);
  if (failed.length > 0) {
    console.log(`Failed: ${failed.join(", ")}`);
    process.exit(1);
  }
  console.log("All checks passed.");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [command, ...rest] = process.argv.slice(2);
  if (command === "run") run(rest);
  else if (command === "report") report(rest);
  else {
    console.error("usage: main-quality-guard.mjs run|report <results.json> [options]");
    process.exit(2);
  }
}
