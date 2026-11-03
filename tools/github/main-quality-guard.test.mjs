import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { hasSummary } from "./issue-summary.mjs";
import {
  CHECKS,
  FAIL_MARKER,
  ISSUE_LABELS,
  ISSUE_TITLE,
  PASS_MARKER,
  decideAction,
  failureComment,
  failureExcerpt,
  issueBody,
  issueNumberFromUrl,
  lastGuardComment,
  passComment,
  pickOpenIssue,
  runChecks,
} from "./main-quality-guard.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const workflow = readFileSync(path.join(repoRoot, ".github/workflows/main-quality-guard.yml"), "utf8");

const context = { sha: "03a5f4fbee83ab375e12a5c63013dcc3c8aae8bd", runUrl: "https://github.com/o/r/actions/runs/1" };
const duplicateFailure = {
  id: "duplicate-code",
  command: "pnpm run check:duplicate-code",
  ok: false,
  exitCode: 1,
  output: [
    "",
    "> @wgw/workspace@ check:duplicate-code /home/runner/work/x",
    "> node tools/duplicate-code-ratchet.mjs check",
    "",
    "\u001b[31mDuplicate-code ratchet failed (1):\u001b[0m",
    "",
    "  - packages/api/app: duplicated lines grew from 2908 to 2911",
    "",
  ].join("\n"),
};
const passed = { id: "file-size", command: "pnpm run check:file-size", ok: true, exitCode: 0, output: "ok" };

test("the excerpt drops colour codes, pnpm echo lines and blank edges", () => {
  const { lines, omitted } = failureExcerpt(duplicateFailure.output);
  assert.deepEqual(lines, [
    "Duplicate-code ratchet failed (1):",
    "",
    "  - packages/api/app: duplicated lines grew from 2908 to 2911",
  ]);
  assert.equal(omitted, 0);
});

test("the excerpt keeps the last lines and counts the rest", () => {
  const output = Array.from({ length: 50 }, (_, i) => `line ${i + 1}`).join("\n");
  const { lines, omitted } = failureExcerpt(output, 30);
  assert.equal(lines.length, 30);
  assert.equal(lines[0], "line 21");
  assert.equal(lines.at(-1), "line 50");
  assert.equal(omitted, 20);
});

test("the excerpt removes URLs and tokens", () => {
  const token = `ghp_${"a".repeat(36)}`;
  const { lines } = failureExcerpt(`fetch https://mail.example.org/api failed\nauth ${token}`);
  assert.deepEqual(lines, ["fetch <url removed> failed", "auth <token removed>"]);
});

test("the issue body opens with a filled Summary and names the failed check only", () => {
  const body = issueBody({ results: [passed, duplicateFailure], ...context });
  assert.equal(hasSummary(body), true);
  assert.ok(body.startsWith(FAIL_MARKER));
  assert.match(body, /### `duplicate-code` failed/);
  assert.doesNotMatch(body, /`file-size` failed/);
  assert.match(body, /duplicated lines grew from 2908 to 2911/);
  assert.match(body, new RegExp(context.sha));
  assert.match(body, /\[workflow run\]\(https:\/\/github\.com\/o\/r\/actions\/runs\/1\)/);
  assert.doesNotMatch(body, /check:duplicate-code \/home/);
});

test("a missing results file reports a setup failure", () => {
  const body = issueBody({ results: null, ...context });
  assert.match(body, /### Setup failed/);
  assert.equal(hasSummary(body), true);
});

test("output with backticks gets a longer fence", () => {
  const result = { ...duplicateFailure, output: "```\nnested\n```" };
  const body = failureComment({ results: [result], ...context });
  assert.match(body, /````text\n```\nnested\n```\n````/);
});

test("a very long failure stays under the GitHub body limit", () => {
  const long = "x".repeat(199);
  const output = Array.from({ length: 400 }, () => long).join("\n");
  const results = Array.from({ length: 20 }, (_, i) => ({ ...duplicateFailure, id: `c${i}`, output }));
  assert.ok(issueBody({ results, ...context }).length < 65536);
});

test("decideAction opens, comments, or stays quiet", () => {
  assert.equal(decideAction({ failed: true, openIssue: null }), "create");
  assert.equal(decideAction({ failed: true, openIssue: 7 }), "comment-failure");
  assert.equal(decideAction({ failed: false, openIssue: null }), "none");
  assert.equal(decideAction({ failed: false, openIssue: 7, lastGuardCommentBody: null }), "comment-pass");
  assert.equal(
    decideAction({ failed: false, openIssue: 7, lastGuardCommentBody: `${FAIL_MARKER}\nstill` }),
    "comment-pass",
  );
  assert.equal(
    decideAction({ failed: false, openIssue: 7, lastGuardCommentBody: passComment(context) }),
    "none",
  );
  assert.ok(passComment(context).startsWith(PASS_MARKER));
});

const humanReply = "Confirmed, fixed in #1777.";

test("lastGuardComment skips comments without a marker", () => {
  assert.equal(lastGuardComment([]), null);
  assert.equal(lastGuardComment([humanReply, null]), null);
  const fail = failureComment({ results: [duplicateFailure], ...context });
  const pass = passComment(context);
  assert.equal(lastGuardComment([fail, pass, humanReply]), pass);
  assert.equal(lastGuardComment([pass, fail, humanReply]), fail);
});

test("a pass comment followed by a human reply does not post the pass comment again", () => {
  const bodies = [failureComment({ results: [duplicateFailure], ...context }), passComment(context), humanReply];
  assert.equal(decideAction({ failed: false, openIssue: 7, lastGuardCommentBody: lastGuardComment(bodies) }), "none");
});

test("a fail comment followed by a human reply still counts as failing", () => {
  const bodies = [failureComment({ results: [duplicateFailure], ...context }), humanReply];
  const lastGuard = lastGuardComment(bodies);
  // Still failing: comment on the open issue, never open a second one.
  assert.equal(decideAction({ failed: true, openIssue: 7, lastGuardCommentBody: lastGuard }), "comment-failure");
  // Green again: post the pass comment once.
  assert.equal(decideAction({ failed: false, openIssue: 7, lastGuardCommentBody: lastGuard }), "comment-pass");
  const afterPass = lastGuardComment([...bodies, passComment(context), humanReply]);
  assert.equal(decideAction({ failed: false, openIssue: 7, lastGuardCommentBody: afterPass }), "none");
});

test("pickOpenIssue takes the oldest exact title match", () => {
  assert.equal(pickOpenIssue([{ number: 3, title: "other" }]), null);
  assert.equal(
    pickOpenIssue([
      { number: 9, title: ISSUE_TITLE },
      { number: 4, title: ISSUE_TITLE },
      { number: 2, title: `${ISSUE_TITLE} (old)` },
    ]),
    4,
  );
});

test("issueNumberFromUrl reads the number gh prints", () => {
  assert.equal(issueNumberFromUrl("https://github.com/o/r/issues/1790\n"), 1790);
  assert.throws(() => issueNumberFromUrl("oops"));
});

test("runChecks records exit codes and merged output", () => {
  const results = runChecks(
    [
      { id: "ok", command: "echo fine" },
      { id: "bad", command: "echo out; echo err >&2; exit 3" },
    ],
    { log: () => {} },
  );
  assert.deepEqual(
    results.map(({ id, ok, exitCode }) => ({ id, ok, exitCode })),
    [
      { id: "ok", ok: true, exitCode: 0 },
      { id: "bad", ok: false, exitCode: 3 },
    ],
  );
  assert.match(results[1].output, /out\nerr/);
});

test("every check command names a script that exists", () => {
  const rootScripts = JSON.parse(readFileSync(path.join(repoRoot, "package.json"), "utf8")).scripts;
  const apiScripts = JSON.parse(readFileSync(path.join(repoRoot, "packages/api/composer.json"), "utf8")).scripts;
  for (const { id, command } of CHECKS) {
    const pnpm = /^pnpm run (\S+)$/.exec(command);
    const composer = /^composer --working-dir packages\/api (\S+)$/.exec(command);
    assert.ok(pnpm || composer, `${id}: unexpected command shape: ${command}`);
    if (pnpm) assert.ok(rootScripts[pnpm[1]], `${id}: no root script ${pnpm[1]}`);
    if (composer) assert.ok(apiScripts[composer[1]], `${id}: no composer script ${composer[1]}`);
  }
});

test("the guard covers the repo-wide ratchets", () => {
  const commands = CHECKS.map((check) => check.command);
  for (const script of ["check:file-size", "check:hook-size", "check:duplicate-code", "check:agent-docs"]) {
    assert.ok(commands.includes(`pnpm run ${script}`), script);
  }
  assert.deepEqual(ISSUE_LABELS, ["type:bug", "area:platform"]);
});

test("the workflow runs on pushes to main, reports even after a failure, and only for main", () => {
  assert.match(workflow, /\non:\n {2}push:\n {4}branches: \[main\]\n {2}workflow_dispatch:\n/);
  assert.match(workflow, /\npermissions:\n {2}contents: read\n {2}issues: write\n\n/);
  assert.match(workflow, /concurrency:\n {2}group: main-quality-guard-\$\{\{ github\.ref \}\}\n {2}cancel-in-progress: true/);
  assert.match(workflow, /node tools\/github\/main-quality-guard\.mjs run "\$RUNNER_TEMP\/main-quality-guard\.json"/);
  assert.match(workflow, /if: \$\{\{ !cancelled\(\) && github\.ref == 'refs\/heads\/main' \}\}/);
  assert.match(workflow, /node tools\/github\/main-quality-guard\.mjs report "\$RUNNER_TEMP\/main-quality-guard\.json"/);
  // Only the report step gets the token; the checks run without it.
  assert.equal((workflow.match(/GH_TOKEN:/g) ?? []).length, 1);
  assert.ok(workflow.indexOf("GH_TOKEN:") > workflow.indexOf("main-quality-guard.mjs run"));
  assert.doesNotMatch(workflow, /secrets\./);
  assert.match(workflow, /actions\/checkout@v7\n {8}with:\n(?: {10}#.*\n)* {10}persist-credentials: false\n/);
});
