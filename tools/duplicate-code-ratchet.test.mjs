import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  DUPLICATE_SCOPES,
  evaluate,
  formatBaseline,
  isExcludedFromDuplicateScan,
  jscpdArgs,
  largestBlocks,
  listScopeFiles,
  measureScopes,
  nextBaseline,
  parseBaseline,
  summarizeReport,
} from "./duplicate-code-ratchet.mjs";

const apps = "packages/apps/src";
const api = "packages/api/app";

function baseline(appsTotals, apiTotals, extra = {}) {
  return {
    jscpd: "5.4.1",
    minTokens: 70,
    minLines: 10,
    scopes: {
      [api]: { clones: apiTotals[0], duplicatedLines: apiTotals[1] },
      [apps]: { clones: appsTotals[0], duplicatedLines: appsTotals[1] },
    },
    ...extra,
  };
}

function measured(appsTotals, apiTotals) {
  return {
    [api]: { clones: apiTotals[0], duplicatedLines: apiTotals[1] },
    [apps]: { clones: appsTotals[0], duplicatedLines: appsTotals[1] },
  };
}

const settings = { jscpdVersion: "5.4.1" };

test("scopes are the apps TypeScript tree and the API PHP tree", () => {
  assert.deepEqual(
    DUPLICATE_SCOPES.map((scope) => [scope.root, [...scope.extensions].sort()]),
    [
      [apps, [".ts", ".tsx"]],
      [api, [".php"]],
    ],
  );
});

test("excludes the file-size ratchet's test, story, mock, fixture and declaration files", () => {
  for (const rel of [
    `${apps}/drive-core/src/drive.test.ts`,
    `${apps}/drive-core/src/drive.spec.tsx`,
    `${apps}/drive-core/src/drive.stories.tsx`,
    `${apps}/drive-core/src/drive.mock.ts`,
    `${apps}/drive-core/src/drive.fixture.ts`,
    `${apps}/types/global.d.ts`,
    `${apps}/lib/__mocks__/http.ts`,
    `${apps}/lib/test-utils/render.tsx`,
    `${apps}/lib/fixtures/events.ts`,
  ]) {
    assert.equal(isExcludedFromDuplicateScan(rel), true, rel);
  }
});

test("also excludes story, mock and test folders and plural fixtures files", () => {
  for (const rel of [
    `${apps}/drive-core/stories/drive-story-shared.ts`,
    `${apps}/lib/api/mock/admin-bootstrap.ts`,
    `${apps}/lib/adapters/mocks/adapter.ts`,
    `${apps}/lib/calendar-engine/tests/support/build.ts`,
    `${apps}/lib/__tests__/helper.ts`,
    `${apps}/chat-ui/stories/chat-stories.fixtures.ts`,
    `${apps}/chat-ui/src/chat.fixtures.tsx`,
  ]) {
    assert.equal(isExcludedFromDuplicateScan(rel), true, rel);
  }
});

test("keeps production sources whose names only contain a test word", () => {
  for (const rel of [
    `${apps}/drive-core/src/use-drive-controller.ts`,
    `${apps}/admin-core/src/mock-mode-banner.tsx`,
    `${apps}/storybook-helpers/src/story-shell.tsx`,
    `${api}/Services/Calendars/CalendarRepository.php`,
    `${api}/Tests/Support.php`,
  ]) {
    assert.equal(isExcludedFromDuplicateScan(rel), false, rel);
  }
});

test("listScopeFiles walks one scope, applies exclusions and sorts paths", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "dup-ratchet-list-"));
  try {
    const root = path.join(dir, apps);
    mkdirSync(path.join(root, "b"), { recursive: true });
    mkdirSync(path.join(root, "a", "stories"), { recursive: true });
    writeFileSync(path.join(root, "b", "z.ts"), "export const z = 1;\n");
    writeFileSync(path.join(root, "b", "y.tsx"), "export const y = 1;\n");
    writeFileSync(path.join(root, "b", "y.test.tsx"), "test\n");
    writeFileSync(path.join(root, "b", "notes.md"), "# notes\n");
    writeFileSync(path.join(root, "a", "stories", "s.ts"), "story\n");
    writeFileSync(path.join(root, "a", "x.ts"), "export const x = 1;\n");
    const scope = DUPLICATE_SCOPES.find((entry) => entry.root === apps);
    assert.deepEqual(listScopeFiles(scope, dir), [
      `${apps}/a/x.ts`,
      `${apps}/b/y.tsx`,
      `${apps}/b/z.ts`,
    ]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("listScopeFiles fails when the scope root is missing", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "dup-ratchet-missing-"));
  try {
    const scope = DUPLICATE_SCOPES.find((entry) => entry.root === api);
    assert.throws(() => listScopeFiles(scope, dir), /scope root missing: packages\/api\/app/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("jscpd arguments pin every option that changes the totals", () => {
  const scope = DUPLICATE_SCOPES.find((entry) => entry.root === api);
  const args = jscpdArgs(scope, ["packages/api/app/A.php"], {
    outDir: "/tmp/out",
    configPath: "/tmp/out/config.json",
    minTokens: 70,
    minLines: 10,
  });
  const value = (flag) => args[args.indexOf(flag) + 1];
  assert.equal(value("--min-tokens"), "70");
  assert.equal(value("--min-lines"), "10");
  assert.equal(value("--format"), "php");
  assert.equal(value("--mode"), "mild");
  assert.equal(value("--kind"), "exact");
  assert.equal(value("--max-size"), "1mb");
  assert.equal(value("--workers"), "1");
  assert.equal(value("--reporters"), "json");
  assert.equal(value("--output"), "/tmp/out");
  assert.equal(value("--config"), "/tmp/out/config.json");
  assert.ok(args.includes("--no-gitignore"), "gitignore must not change the scanned set");
  assert.ok(args.includes("--absolute"));
  assert.equal(args.at(-1), "packages/api/app/A.php");
});

test("summarizeReport uses jscpd totals and repo-relative, ordered blocks", () => {
  const base = "/repo";
  const report = {
    statistics: { total: { clones: 2, duplicatedLines: 31, sources: 3 } },
    duplicates: [
      {
        lines: 12,
        tokens: 80,
        firstFile: { name: "/repo/packages/api/app/B.php", start: 40, end: 51 },
        secondFile: { name: "/repo/packages/api/app/A.php", start: 3, end: 14 },
      },
      {
        lines: 19,
        tokens: 120,
        firstFile: { name: "/repo/packages/api/app/C.php", start: 1, end: 19 },
        secondFile: { name: "/repo/packages/api/app/D.php", start: 5, end: 23 },
      },
    ],
  };
  const summary = summarizeReport(report, base);
  assert.equal(summary.clones, 2);
  assert.equal(summary.duplicatedLines, 31);
  assert.equal(summary.sources, 3);
  assert.deepEqual(summary.blocks[0], {
    lines: 19,
    tokens: 120,
    first: { path: "packages/api/app/C.php", start: 1, end: 19 },
    second: { path: "packages/api/app/D.php", start: 5, end: 23 },
  });
  assert.deepEqual(summary.blocks[1].first, { path: "packages/api/app/A.php", start: 3, end: 14 });
  assert.deepEqual(summary.blocks[1].second, {
    path: "packages/api/app/B.php",
    start: 40,
    end: 51,
  });
});

test("largestBlocks orders by lines, then by location, and keeps the top n", () => {
  const block = (lines, file) => ({
    lines,
    tokens: lines * 8,
    first: { path: file, start: 1, end: lines },
    second: { path: `${file}.copy`, start: 1, end: lines },
  });
  const blocks = [block(10, "b"), block(30, "z"), block(10, "a"), block(20, "c")];
  assert.deepEqual(
    largestBlocks(blocks, 3).map((entry) => [entry.lines, entry.first.path]),
    [
      [30, "z"],
      [20, "c"],
      [10, "a"],
    ],
  );
});

test("evaluate passes when every total matches the baseline", () => {
  const { errors } = evaluate(
    measured([101, 1755], [330, 5390]),
    baseline([101, 1755], [330, 5390]),
    settings,
  );
  assert.deepEqual(errors, []);
});

test("evaluate fails when duplicated lines grow", () => {
  const { errors } = evaluate(
    measured([101, 1767], [330, 5390]),
    baseline([101, 1755], [330, 5390]),
    settings,
  );
  assert.deepEqual(errors, [`${apps}: duplicated lines grew from 1755 to 1767`]);
});

test("evaluate fails when the clone count grows", () => {
  const { errors } = evaluate(
    measured([101, 1755], [331, 5390]),
    baseline([101, 1755], [330, 5390]),
    settings,
  );
  assert.deepEqual(errors, [`${api}: clones grew from 330 to 331`]);
});

test("evaluate fails when a total drops and the baseline was not lowered", () => {
  const { errors } = evaluate(
    measured([100, 1740], [330, 5390]),
    baseline([101, 1755], [330, 5390]),
    settings,
  );
  assert.deepEqual(errors, [
    `${apps}: clones dropped from 101 to 100; run pnpm duplicate-code:update and commit the baseline`,
    `${apps}: duplicated lines dropped from 1755 to 1740; run pnpm duplicate-code:update and commit the baseline`,
  ]);
});

test("evaluate fails when the installed jscpd differs from the baseline", () => {
  const { errors } = evaluate(
    measured([101, 1755], [330, 5390]),
    baseline([101, 1755], [330, 5390]),
    {
      jscpdVersion: "5.5.0",
    },
  );
  assert.equal(errors.length, 1);
  assert.match(errors[0], /jscpd 5\.5\.0 is installed but the baseline was measured with 5\.4\.1/);
});

test("evaluate fails when a scope is missing from the baseline or the measurement", () => {
  const rows = baseline([101, 1755], [330, 5390]);
  delete rows.scopes[api];
  const { errors } = evaluate(measured([101, 1755], [330, 5390]), rows, settings);
  assert.deepEqual(errors, [`${api}: scope has no baseline entry`]);

  const extra = baseline([101, 1755], [330, 5390]);
  extra.scopes["packages/other"] = { clones: 1, duplicatedLines: 10 };
  assert.deepEqual(evaluate(measured([101, 1755], [330, 5390]), extra, settings).errors, [
    "packages/other: baseline entry is not a scanned scope",
  ]);
});

test("nextBaseline lowers totals that dropped and keeps the rest", () => {
  const { baseline: next, errors } = nextBaseline(
    measured([99, 1700], [330, 5390]),
    baseline([101, 1755], [330, 5390]),
    settings,
  );
  assert.deepEqual(errors, []);
  assert.deepEqual(next, baseline([99, 1700], [330, 5390]));
});

test("nextBaseline refuses to raise a total", () => {
  const { baseline: next, errors } = nextBaseline(
    measured([102, 1700], [330, 5400]),
    baseline([101, 1755], [330, 5390]),
    settings,
  );
  assert.deepEqual(errors, [
    `${apps}: update refuses to raise clones from 101 to 102`,
    `${api}: update refuses to raise duplicated lines from 5390 to 5400`,
  ]);
  assert.equal(next, null);
});

test("nextBaseline refuses to run against a different jscpd version", () => {
  const { errors } = nextBaseline(
    measured([101, 1755], [330, 5390]),
    baseline([101, 1755], [330, 5390]),
    {
      jscpdVersion: "6.0.0",
    },
  );
  assert.equal(errors.length, 1);
  assert.match(errors[0], /jscpd 6\.0\.0 is installed/);
});

test("parseBaseline rejects a malformed file and formatBaseline round-trips", () => {
  const rows = baseline([101, 1755], [330, 5390]);
  const text = formatBaseline(rows);
  assert.ok(text.endsWith("}\n"));
  assert.deepEqual(parseBaseline(text), rows);
  assert.ok(text.indexOf(api) < text.indexOf(apps), "scopes are written in sorted order");

  assert.throws(() => parseBaseline("{}"), /baseline: jscpd must be a version string/);
  assert.throws(
    () => parseBaseline(JSON.stringify({ ...rows, minTokens: "70" })),
    /baseline: minTokens must be a positive integer/,
  );
  assert.throws(
    () =>
      parseBaseline(
        JSON.stringify({ ...rows, scopes: { [apps]: { clones: 1, duplicatedLines: -1 } } }),
      ),
    /baseline: packages\/apps\/src duplicatedLines must be a non-negative integer/,
  );
});

test("measureScopes runs jscpd and finds a block copied between two files", async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "dup-ratchet-jscpd-"));
  try {
    const root = path.join(dir, apps, "demo");
    mkdirSync(root, { recursive: true });
    const block = Array.from(
      { length: 14 },
      (_, i) => `  const value${i} = compute(input, ${i}, "label-${i}") + offset * ${i};`,
    ).join("\n");
    const file = (name) =>
      `export function ${name}(input: number, offset: number) {\n${block}\n  return 0;\n}\n`;
    writeFileSync(path.join(root, "one.ts"), file("one"));
    writeFileSync(path.join(root, "two.ts"), file("two"));
    writeFileSync(path.join(root, "two.test.ts"), file("three"));
    mkdirSync(path.join(dir, api), { recursive: true });
    writeFileSync(path.join(dir, api, "Only.php"), "<?php\n\nfinal class Only {}\n");

    const result = await measureScopes({ baseDir: dir, minTokens: 70, minLines: 10 });
    assert.equal(result[apps].clones, 1);
    assert.ok(result[apps].duplicatedLines >= 14, `got ${result[apps].duplicatedLines}`);
    assert.deepEqual(
      [result[apps].blocks[0].first.path, result[apps].blocks[0].second.path],
      [`${apps}/demo/one.ts`, `${apps}/demo/two.ts`],
    );
    assert.equal(result[api].clones, 0);
    assert.equal(result[api].duplicatedLines, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
