import assert from "node:assert/strict";
import test from "node:test";

import {
  baselineGrowthErrors,
  classifyGitShowBaselineStderr,
  countLines,
  evaluate,
  FILE_SIZE_RULE,
  growthBaseRefFromArgs,
  nextBaseline,
  rebaselineRows,
} from "./file-size-ratchet.mjs";

const ceiling = 800;

function row(filePath, count, reason = "grandfathered") {
  return { path: filePath, count, reason };
}

test("counts a last line that has no trailing newline", () => {
  assert.equal(countLines("a\nb"), 2);
  assert.equal(countLines("a\nb\n"), 2);
  assert.equal(countLines(""), 0);
  assert.equal(countLines("\n"), 1);
});

test("rule sentence names both the new-file and the shrink cases", () => {
  assert.match(FILE_SIZE_RULE, /over 800 lines/);
  assert.match(FILE_SIZE_RULE, /stored integer was not lowered/);
});

test("evaluate errors when a baselined file grew", () => {
  const counts = new Map([["packages/apps/src/big.ts", 910]]);
  const rows = [row("packages/apps/src/big.ts", 900)];
  const { errors } = evaluate(counts, rows, { ceiling });
  assert.equal(errors.length, 1);
  assert.match(errors[0], /grew from 900 to 910/);
});

test("nextBaseline refuses to raise a stored count", () => {
  const counts = new Map([["packages/apps/src/big.ts", 910]]);
  const rows = [row("packages/apps/src/big.ts", 900)];
  const { rows: next, errors } = nextBaseline(counts, rows, { ceiling });
  assert.equal(next.length, 0);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /refuses to raise 900 to 910/);
});

test("evaluate errors when a baselined file shrank without update", () => {
  const counts = new Map([["packages/apps/src/big.ts", 850]]);
  const rows = [row("packages/apps/src/big.ts", 900)];
  const { errors } = evaluate(counts, rows, { ceiling });
  assert.equal(errors.length, 1);
  assert.match(errors[0], /shrunk from 900 to 850; run pnpm ratchet:update/);
});

test("nextBaseline lowers a stored count when still over the ceiling", () => {
  const counts = new Map([["packages/apps/src/big.ts", 850]]);
  const rows = [row("packages/apps/src/big.ts", 900)];
  const { rows: next, errors } = nextBaseline(counts, rows, { ceiling });
  assert.deepEqual(errors, []);
  assert.deepEqual(next, [row("packages/apps/src/big.ts", 850)]);
});

test("evaluate missing-file message includes ratchet:update; nextBaseline drops the row", () => {
  const counts = new Map();
  const rows = [row("packages/apps/src/gone.ts", 900)];
  const { errors } = evaluate(counts, rows, { ceiling });
  assert.equal(errors.length, 1);
  assert.match(errors[0], /missing or excluded; run pnpm ratchet:update/);

  const { rows: next, errors: updateErrors } = nextBaseline(counts, rows, { ceiling });
  assert.deepEqual(updateErrors, []);
  assert.deepEqual(next, []);
});

test("evaluate errors when a counted file is over the ceiling with no baseline row", () => {
  const counts = new Map([["packages/apps/src/new-big.ts", 900]]);
  const { errors } = evaluate(counts, [], { ceiling });
  assert.equal(errors.length, 1);
  assert.match(errors[0], /900 lines and not on the baseline/);
});

test("evaluate errors when the baseline is unsorted", () => {
  const counts = new Map([
    ["packages/apps/src/a.ts", 900],
    ["packages/apps/src/b.ts", 900],
  ]);
  const rows = [row("packages/apps/src/b.ts", 900), row("packages/apps/src/a.ts", 900)];
  const { errors } = evaluate(counts, rows, { ceiling });
  assert.ok(errors.some((error) => /baseline is not sorted/.test(error)));
});

test("evaluate errors when a baseline row is outside the counted trees", () => {
  const counts = new Map();
  const rows = [row("packages/other/outside.ts", 900)];
  const { errors } = evaluate(counts, rows, { ceiling });
  assert.ok(errors.some((error) => /outside the counted trees/.test(error)));
});

test("evaluate reports an out-of-tree row even when onlyRoot scopes the run", () => {
  const counts = new Map([["packages/apps/src/ok.ts", 100]]);
  const rows = [row("docs/typo.ts", 900)];
  const { errors } = evaluate(counts, rows, { ceiling, onlyRoot: "packages/apps/src" });
  assert.ok(errors.some((error) => /outside the counted trees/.test(error)));
});

test("rebaseline raises, lowers, drops <= ceiling, and does not add a path", () => {
  const counts = new Map([
    ["packages/apps/src/grew.ts", 920],
    ["packages/apps/src/shrunk.ts", 850],
    ["packages/apps/src/under.ts", 700],
    ["packages/apps/src/extra.ts", 950],
  ]);
  const rows = [
    row("packages/apps/src/grew.ts", 900),
    row("packages/apps/src/shrunk.ts", 900),
    row("packages/apps/src/under.ts", 900),
    row("packages/apps/src/missing.ts", 900),
  ];
  const { rows: next } = rebaselineRows(counts, rows, { ceiling });
  assert.deepEqual(next, [
    row("packages/apps/src/grew.ts", 920),
    row("packages/apps/src/shrunk.ts", 850),
  ]);
  assert.ok(!next.some((entry) => entry.path === "packages/apps/src/extra.ts"));
  assert.ok(!next.some((entry) => entry.path === "packages/apps/src/missing.ts"));
  assert.ok(!next.some((entry) => entry.path === "packages/apps/src/under.ts"));
});

test("nextBaseline result paths are a subset of the input paths", () => {
  const counts = new Map([
    ["packages/apps/src/a.ts", 850],
    ["packages/apps/src/forged.ts", 950],
  ]);
  const rows = [row("packages/apps/src/a.ts", 900)];
  const { rows: next } = nextBaseline(counts, rows, { ceiling });
  assert.deepEqual(
    next.map((entry) => entry.path),
    ["packages/apps/src/a.ts"],
  );
});

test("evaluate with onlyRoot still defaults ceiling so a ~100-line file is fine", () => {
  const counts = new Map([["packages/apps/src/small.ts", 100]]);
  const { errors } = evaluate(counts, [], { onlyRoot: "packages/apps/src" });
  assert.deepEqual(errors, []);
});

test("evaluate with an explicit ceiling still enforces that ceiling", () => {
  const counts = new Map([["packages/apps/src/small.ts", 100]]);
  const { errors } = evaluate(counts, [], { ceiling: 50, onlyRoot: "packages/apps/src" });
  assert.equal(errors.length, 1);
  assert.match(errors[0], /100 lines and not on the baseline/);
});

test("baselineGrowthErrors rejects a higher count", () => {
  const base = [row("packages/apps/src/big.ts", 900)];
  const head = [row("packages/apps/src/big.ts", 910)];
  const errors = baselineGrowthErrors(base, head);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /baseline grew from 900 to 910/);
});

test("baselineGrowthErrors rejects a new path", () => {
  const errors = baselineGrowthErrors([], [row("packages/apps/src/new.ts", 900)]);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /new baseline row/);
});

test("baselineGrowthErrors allows a lower count", () => {
  const base = [row("packages/apps/src/big.ts", 900)];
  const head = [row("packages/apps/src/big.ts", 850)];
  assert.deepEqual(baselineGrowthErrors(base, head), []);
});

test("baselineGrowthErrors allows a deleted row", () => {
  const base = [row("packages/apps/src/gone.ts", 900)];
  assert.deepEqual(baselineGrowthErrors(base, []), []);
});

test("baselineGrowthErrors allows identical rows", () => {
  const rows = [row("packages/apps/src/big.ts", 900)];
  assert.deepEqual(baselineGrowthErrors(rows, rows), []);
});

test("growthBaseRefFromArgs skips a leading pnpm double-dash", () => {
  assert.equal(growthBaseRefFromArgs(["--", "abc123"]), "abc123");
  assert.equal(growthBaseRefFromArgs(["abc123"]), "abc123");
  assert.equal(growthBaseRefFromArgs(["--"]), "");
  assert.equal(growthBaseRefFromArgs([]), "");
});

test("classifyGitShowBaselineStderr treats a missing path as empty baseline", () => {
  assert.equal(
    classifyGitShowBaselineStderr(
      "fatal: path 'tools/file-size-baseline.tsv' does not exist in 'origin/main'",
    ),
    "missing-path",
  );
  assert.equal(
    classifyGitShowBaselineStderr(
      "fatal: path 'tools/file-size-baseline.tsv' exists on disk, but not in 'origin/main'",
    ),
    "missing-path",
  );
});

test("classifyGitShowBaselineStderr treats an unknown ref as a hard fail", () => {
  assert.equal(
    classifyGitShowBaselineStderr("fatal: invalid object name 'deadbeef'."),
    "unknown-ref",
  );
  assert.equal(
    classifyGitShowBaselineStderr("fatal: Not a valid object name deadbeef"),
    "unknown-ref",
  );
});
