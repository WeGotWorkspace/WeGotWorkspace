import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { isCursorAgentAuthorEmail } from "./cursor-attribution.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const rangeCheck = path.join(repoRoot, "tools/git/check-commit-range-attribution.mjs");

test("cursor agent author domains are rejected", () => {
  assert.equal(isCursorAgentAuthorEmail("cursoragent@cursor.com"), true);
  assert.equal(isCursorAgentAuthorEmail("agent@cursor.sh"), true);
  assert.equal(isCursorAgentAuthorEmail("Agent@Cursor.SH"), true);
  assert.equal(isCursorAgentAuthorEmail("dev@cursor.com"), true);
});

test("human and github noreply authors are allowed", () => {
  assert.equal(isCursorAgentAuthorEmail("wouter@woutervroege.nl"), false);
  assert.equal(isCursorAgentAuthorEmail("206951365+cursor[bot]@users.noreply.github.com"), false);
  assert.equal(isCursorAgentAuthorEmail("user@cursor.com.example"), false);
  assert.equal(isCursorAgentAuthorEmail(""), false);
  assert.equal(isCursorAgentAuthorEmail(null), false);
});

function commitAs(repo, email) {
  execFileSync("git", ["init", "-b", "main"], { cwd: repo });
  writeFileSync(path.join(repo, "f"), "x\n");
  execFileSync("git", ["add", "f"], { cwd: repo });
  execFileSync(
    "git",
    [
      "-c",
      "commit.gpgsign=false",
      "-c",
      `user.name=Range Check`,
      "-c",
      `user.email=${email}`,
      "commit",
      "-m",
      "probe",
    ],
    { cwd: repo },
  );
}

function rangeCheckStatus(repo) {
  return spawnSync(process.execPath, [rangeCheck, "HEAD"], {
    cwd: repo,
    encoding: "utf8",
  });
}

test("the commit range check rejects agent@cursor.sh", () => {
  const repo = mkdtempSync(path.join(tmpdir(), "cursor-attribution-"));
  try {
    commitAs(repo, "agent@cursor.sh");
    const result = rangeCheckStatus(repo);
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, /Cursor attribution/);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("the commit range check allows a human author", () => {
  const repo = mkdtempSync(path.join(tmpdir(), "cursor-attribution-"));
  try {
    commitAs(repo, "wouter@woutervroege.nl");
    const result = rangeCheckStatus(repo);
    assert.equal(result.status, 0, result.stderr);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});
