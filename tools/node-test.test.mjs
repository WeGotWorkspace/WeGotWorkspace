import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const wrapper = path.join(repoRoot, "tools/node-test.sh");

function run(args, cwd = repoRoot) {
  const env = { ...process.env };
  // A parent `node --test` sets this. The child would then skip the files.
  delete env.NODE_TEST_CONTEXT;
  return spawnSync(wrapper, args, { cwd, encoding: "utf8", env });
}

function writeTest(file, source) {
  writeFileSync(file, source.endsWith("\n") ? source : `${source}\n`);
}

test("a missing path exits 1 and names the file", () => {
  const missing = "tools/does-not-exist-1013.test.mjs";
  const result = run([missing]);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /node-test: missing test file: tools\/does-not-exist-1013\.test\.mjs/);
});

test("a missing path among present files fails before node --test runs", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "node-test-"));
  const present = path.join(dir, "present.test.mjs");
  const missing = path.join(dir, "missing.test.mjs");
  writeTest(
    present,
    [
      'import test from "node:test";',
      'test("present ran", () => {',
      '  throw new Error("should not run");',
      "});",
    ].join("\n"),
  );

  try {
    const result = run([present, missing]);
    assert.equal(result.status, 1);
    assert.equal(result.stderr.includes(`node-test: missing test file: ${missing}`), true);
    assert.equal(result.stdout.includes("present ran"), false);
    assert.equal(result.stderr.includes("should not run"), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a present file is passed through to node --test", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "node-test-"));
  const present = path.join(dir, "present.test.mjs");
  writeTest(
    present,
    [
      'import assert from "node:assert/strict";',
      'import test from "node:test";',
      'test("passes through", () => {',
      "  assert.equal(1, 1);",
      "});",
    ].join("\n"),
  );

  try {
    const result = run([present]);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /passes through/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a leading flag is passed through", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "node-test-"));
  const present = path.join(dir, "present.test.mjs");
  writeTest(
    present,
    ['import test from "node:test";', 'test("passes through", () => {});'].join("\n"),
  );

  try {
    const result = run(["--test-reporter=tap", present]);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /passes through/);
    assert.equal(result.stderr.includes("missing test file"), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a flag without a test file is an error", () => {
  const result = run(["--test-reporter=tap"]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /node-test: no test files given/);
});

test("a directory is rejected", () => {
  const result = run(["tools"]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /node-test: missing test file: tools/);
});

test("a glob pattern is rejected", () => {
  const result = run(["tools/*.test.mjs"]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /node-test: missing test file: tools\/\*\.test\.mjs/);
});

test("no paths is an error", () => {
  const result = run([]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /node-test: no test files given/);
});
