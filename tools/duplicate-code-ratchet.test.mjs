import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  comparePackages,
  copiedLinesPerFile,
  measuredPackages,
  nextPackages,
  packageKey,
  packageTotals,
} from "./duplicate-code-packages.mjs";
import {
  DUPLICATE_SCOPES,
  evaluate,
  formatBaseline,
  isExcludedFromDuplicateScan,
  jscpdArgs,
  largestBlocks,
  listScopeFiles,
  MAX_SOURCE_LINES,
  measureScopes,
  mirrorFiles,
  nextBaseline,
  parseBaseline,
  summarizeReport,
  summaryMarkdown,
} from "./duplicate-code-ratchet.mjs";

const apps = "packages/apps/src";
const api = "packages/api/app";

function baseline(appsTotals, apiTotals, extra = {}) {
  return {
    jscpd: "4.3.0",
    minTokens: 70,
    minLines: 10,
    scopes: {
      [api]: { clones: apiTotals[0], duplicatedLines: apiTotals[1] },
      [apps]: { clones: appsTotals[0], duplicatedLines: appsTotals[1] },
    },
    packages: {},
    ...extra,
  };
}

function measured(appsTotals, apiTotals) {
  return {
    [api]: { clones: apiTotals[0], duplicatedLines: apiTotals[1] },
    [apps]: { clones: appsTotals[0], duplicatedLines: appsTotals[1] },
  };
}

const settings = { jscpdVersion: "4.3.0" };

test("scopes are the apps TypeScript tree and the API PHP tree", () => {
  assert.deepEqual(
    DUPLICATE_SCOPES.map((scope) => [scope.root, [...scope.extensions].sort(), scope.formats]),
    [
      [apps, [".ts", ".tsx"], ["typescript", "tsx"]],
      [api, [".php"], ["php"]],
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
  const args = jscpdArgs(scope, {
    scanRoot: "/tmp/mirror/packages/api/app",
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
  assert.equal(value("--max-lines"), String(MAX_SOURCE_LINES));
  assert.equal(value("--max-size"), String(2 * 1024 * 1024));
  assert.equal(value("--reporters"), "json");
  assert.equal(value("--output"), "/tmp/out");
  assert.equal(value("--config"), "/tmp/out/config.json");
  assert.ok(args.includes("--no-gitignore"), "gitignore must not change the scanned set");
  assert.ok(args.includes("--noSymlinks"));
  assert.ok(args.includes("--absolute"));
  assert.equal(args[0], "/tmp/mirror/packages/api/app");
  assert.ok(!args.includes("--ignore"), "the mirror holds exactly the listed files");
});

test("summarizeReport counts only the scope's formats and orders blocks", () => {
  const base = "/repo";
  const report = {
    statistics: {
      formats: {
        typescript: { total: { clones: 1, duplicatedLines: 12 } },
        tsx: { total: { clones: 1, duplicatedLines: 19 } },
        javascript: { total: { clones: 1, duplicatedLines: 281 } },
      },
      total: { clones: 3, duplicatedLines: 312 },
    },
    duplicates: [
      {
        format: "javascript",
        lines: 281,
        tokens: 900,
        firstFile: { name: "/repo/packages/apps/src/a.tsx", start: 126, end: 406 },
        secondFile: { name: "/repo/packages/apps/src/b.tsx", start: 89, end: 225 },
      },
      {
        format: "typescript",
        lines: 12,
        tokens: 80,
        firstFile: { name: "/repo/packages/apps/src/B.ts", start: 40, end: 51 },
        secondFile: { name: "/repo/packages/apps/src/A.ts", start: 3, end: 14 },
      },
      {
        format: "tsx",
        lines: 19,
        tokens: 120,
        firstFile: { name: "/repo/packages/apps/src/C.tsx", start: 1, end: 19 },
        secondFile: { name: "/repo/packages/apps/src/D.tsx", start: 5, end: 23 },
      },
    ],
  };
  const summary = summarizeReport(report, base, ["typescript", "tsx"]);
  assert.equal(summary.clones, 2, "the embedded javascript stream of TSX does not count");
  assert.equal(summary.duplicatedLines, 31);
  assert.equal(summary.blocks.length, 2);
  assert.deepEqual(summary.blocks[0], {
    lines: 19,
    tokens: 120,
    first: { path: "packages/apps/src/C.tsx", start: 1, end: 19 },
    second: { path: "packages/apps/src/D.tsx", start: 5, end: 23 },
  });
  assert.deepEqual(summary.blocks[1].first, { path: "packages/apps/src/A.ts", start: 3, end: 14 });
  assert.deepEqual(summary.blocks[1].second, {
    path: "packages/apps/src/B.ts",
    start: 40,
    end: 51,
  });
});

test("summarizeReport counts zero for a scope format with no sources", () => {
  const summary = summarizeReport({ statistics: { formats: {} }, duplicates: [] }, "/repo", [
    "php",
  ]);
  assert.deepEqual(summary, { clones: 0, duplicatedLines: 0, blocks: [] });
});

test("mirrorFiles copies the listed files under their repo paths", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "dup-ratchet-mirror-"));
  try {
    const repo = path.join(dir, "repo");
    const mirror = path.join(dir, "mirror");
    mkdirSync(path.join(repo, api, "Services"), { recursive: true });
    writeFileSync(path.join(repo, api, "Services", "A.php"), "<?php\n");
    writeFileSync(path.join(repo, api, "Skipped.php"), "<?php\n");
    mirrorFiles([`${api}/Services/A.php`], repo, mirror);
    assert.equal(readFileSync(path.join(mirror, api, "Services", "A.php"), "utf8"), "<?php\n");
    assert.throws(() => readFileSync(path.join(mirror, api, "Skipped.php")), /ENOENT/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("mirrorFiles fails instead of letting jscpd skip an oversized source", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "dup-ratchet-limit-"));
  try {
    mkdirSync(path.join(dir, apps), { recursive: true });
    writeFileSync(path.join(dir, apps, "huge.ts"), "x;\n".repeat(MAX_SOURCE_LINES + 1));
    assert.throws(
      () => mirrorFiles([`${apps}/huge.ts`], dir, path.join(dir, "mirror")),
      /huge\.ts: 20001 lines .* over the duplicate scan limit/,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
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

test("evaluate passes with a notice when a total drops below the baseline", () => {
  const { errors, notices } = evaluate(
    measured([100, 1740], [330, 5390]),
    baseline([101, 1755], [330, 5390]),
    settings,
  );
  assert.deepEqual(errors, []);
  assert.deepEqual(notices, [
    `${apps}: clones dropped from 101 to 100; pnpm duplicate-code:update can lower the baseline`,
    `${apps}: duplicated lines dropped from 1755 to 1740; pnpm duplicate-code:update can lower the baseline`,
  ]);
});

test("evaluate still fails on growth in one scope while the other drops", () => {
  const { errors, notices } = evaluate(
    measured([100, 1740], [331, 5390]),
    baseline([101, 1755], [330, 5390]),
    settings,
  );
  assert.deepEqual(errors, [`${api}: clones grew from 330 to 331`]);
  assert.equal(notices.length, 2);
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
  assert.match(errors[0], /jscpd 5\.5\.0 is installed but the baseline was measured with 4\.3\.0/);
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

test("measureScopes finds a block copied between two files, ignoring .gitignore", async () => {
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
    writeFileSync(path.join(dir, ".gitignore"), "two.ts\n");
    writeFileSync(path.join(dir, ".jscpd.json"), JSON.stringify({ minTokens: 5000 }));

    const result = await measureScopes({ baseDir: dir, minTokens: 70, minLines: 10 });
    assert.equal(result[apps].files, 2, "two.test.ts is excluded");
    assert.equal(result[apps].clones, 1);
    assert.ok(result[apps].duplicatedLines >= 14, `got ${result[apps].duplicatedLines}`);
    assert.deepEqual(
      [result[apps].blocks[0].first.path, result[apps].blocks[0].second.path],
      [`${apps}/demo/one.ts`, `${apps}/demo/two.ts`],
    );
    assert.equal(result[api].clones, 0);
    assert.equal(result[api].duplicatedLines, 0);
    const demo = result[apps].packages[`${apps}/demo`];
    assert.equal(demo.lines, 34, "two scanned files of 17 lines; the test file does not count");
    assert.ok(demo.duplicatedLines >= 28, `got ${demo.duplicatedLines}`);
    assert.equal(demo.cloneCoverage, Math.round((demo.duplicatedLines / 34) * 10000) / 100);
    assert.deepEqual(result[api].packages, { [api]: { lines: 3, duplicatedLines: 0, cloneCoverage: 0 } });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("packageKey uses the coverage baseline keys for every package it lists", () => {
  const coverageKeys = Object.keys(
    JSON.parse(readFileSync(new URL("./coverage-baseline.json", import.meta.url), "utf8")),
  );
  assert.ok(coverageKeys.length > 0);
  for (const key of coverageKeys) {
    const file = key.startsWith(api) ? `${key}/Sub/Thing.php` : `${key}/src/thing.ts`;
    assert.equal(packageKey(file), key, file);
    if (key.startsWith(api)) assert.equal(packageKey(`${key}/Thing.php`), key);
  }
});

test("packageKey gives files outside the coverage keys their nearest folder", () => {
  assert.equal(packageKey(`${apps}/main.tsx`), apps);
  assert.equal(packageKey(`${apps}/lib/utils.ts`), `${apps}/lib`);
  assert.equal(packageKey(`${apps}/lib/offline/notes-outbox-flush.ts`), `${apps}/lib/offline`);
  assert.equal(packageKey(`${apps}/notes-core/src/notes-workspace.tsx`), `${apps}/notes-core`);
  assert.equal(packageKey(`${api}/Http/Controllers/CalendarController.php`), `${api}/Http`);
  assert.equal(packageKey(`${api}/Services/Calendars/CalendarRepository.php`), `${api}/Services/Calendars`);
  assert.equal(packageKey(`${api}/Services/Helper.php`), `${api}/Services`);
  assert.equal(packageKey(`${api}/helpers.php`), api);
  assert.equal(packageKey("packages/apps/vite.config.ts"), null);
  assert.equal(packageKey("tools/duplicate-code-ratchet.mjs"), null);
});

test("copiedLinesPerFile counts both sides of a clone and overlapping clones once", () => {
  const at = (file, start, end) => ({ path: file, start, end });
  const copied = copiedLinesPerFile([
    { first: at("a.ts", 1, 10), second: at("b.ts", 21, 30) },
    { first: at("a.ts", 6, 15), second: at("c.ts", 1, 10) },
  ]);
  assert.deepEqual(Object.fromEntries(copied), { "a.ts": 15, "b.ts": 10, "c.ts": 10 });
});

test("packageTotals sums scanned and copied lines per package and rounds the percentage", () => {
  const totals = packageTotals(
    new Map([
      [`${apps}/notes-core/src/a.ts`, 100],
      [`${apps}/notes-core/src/b.ts`, 200],
      [`${apps}/tasks-core/src/c.ts`, 50],
      [`${apps}/tasks-core/src/empty.ts`, 0],
      [`${api}/Services/Notes/Repo.php`, 300],
    ]),
    new Map([
      [`${apps}/notes-core/src/a.ts`, 20],
      [`${api}/Services/Notes/Repo.php`, 1],
    ]),
  );
  assert.deepEqual(totals, {
    [`${api}/Services/Notes`]: { lines: 300, duplicatedLines: 1, cloneCoverage: 0.33 },
    [`${apps}/notes-core`]: { lines: 300, duplicatedLines: 20, cloneCoverage: 6.67 },
    [`${apps}/tasks-core`]: { lines: 50, duplicatedLines: 0, cloneCoverage: 0 },
  });
  assert.deepEqual(Object.keys(totals), Object.keys(totals).sort(), "keys are sorted");
});

const pkg = (lines, duplicatedLines) => ({
  lines,
  duplicatedLines,
  cloneCoverage: Math.round((duplicatedLines / lines) * 10000) / 100,
});
const entry = (lines, duplicatedLines) => {
  const { cloneCoverage } = pkg(lines, duplicatedLines);
  return { cloneCoverage, duplicatedLines };
};

test("comparePackages warns once per package whose copied lines grew, new packages from 0", () => {
  const notes = `${apps}/notes-core`;
  const tasks = `${apps}/tasks-core`;
  const drive = `${apps}/drive-core`;
  const chat = `${api}/Services/Chat`;
  const { rows, warnings, dropped } = comparePackages(
    { [notes]: pkg(1000, 60), [tasks]: pkg(500, 10), [drive]: pkg(800, 30), [chat]: pkg(400, 40) },
    { [notes]: entry(1000, 50), [tasks]: entry(500, 20), [chat]: entry(400, 40), [`${api}/Gone`]: entry(10, 5) },
  );
  assert.deepEqual(warnings, [
    `${apps}/drive-core: copied lines grew from 0 (not in the baseline) to 30 (3.75%). pnpm duplicate-code:report lists the duplicated blocks.`,
    `${apps}/notes-core: copied lines grew from 50 (5%) to 60 (6%). pnpm duplicate-code:report lists the duplicated blocks.`,
  ]);
  assert.equal(dropped, 2, "tasks-core went down and a package that is gone counts as a drop");
  assert.deepEqual(
    rows.map((row) => [row.key, row.change]),
    [
      [`${api}/Gone`, -5],
      [chat, 0],
      [drive, 30],
      [notes, 10],
      [tasks, -10],
    ],
  );
});

test("comparePackages does not warn when only the percentage rose", () => {
  const notes = `${apps}/notes-core`;
  const { warnings } = comparePackages({ [notes]: pkg(500, 50) }, { [notes]: entry(1000, 50) });
  assert.deepEqual(warnings, [], "deleting unrelated code raises the share but adds no copy");
});

test("evaluate ignores the per-package numbers, so they never fail the check", () => {
  const notes = `${apps}/notes-core`;
  const rows = baseline([101, 1755], [330, 5390], { packages: { [notes]: entry(1000, 10) } });
  const current = {
    [api]: { clones: 330, duplicatedLines: 5390, packages: {} },
    [apps]: { clones: 101, duplicatedLines: 1755, packages: { [notes]: pkg(1000, 90) } },
  };
  assert.equal(comparePackages(measuredPackages(current), rows.packages).warnings.length, 1);
  assert.deepEqual(evaluate(current, rows, settings).errors, []);
});

test("nextPackages lowers drops, keeps growth, adds new packages and leaves out zeros", () => {
  const next = nextPackages(
    {
      [`${apps}/notes-core`]: pkg(1000, 40),
      [`${apps}/tasks-core`]: pkg(500, 30),
      [`${apps}/drive-core`]: pkg(800, 16),
      [`${apps}/meet-core`]: pkg(300, 0),
    },
    {
      [`${apps}/notes-core`]: entry(1000, 50),
      [`${apps}/tasks-core`]: entry(500, 20),
      [`${apps}/meet-core`]: entry(300, 12),
      [`${api}/Gone`]: entry(10, 5),
    },
  );
  assert.deepEqual(next, {
    [`${apps}/drive-core`]: entry(800, 16),
    [`${apps}/notes-core`]: entry(1000, 40),
    [`${apps}/tasks-core`]: entry(500, 20),
  });
});

test("nextBaseline also updates the package entries", () => {
  const notes = `${apps}/notes-core`;
  const current = {
    [api]: { clones: 330, duplicatedLines: 5390, packages: {} },
    [apps]: { clones: 100, duplicatedLines: 1740, packages: { [notes]: pkg(1000, 40) } },
  };
  const { baseline: next } = nextBaseline(
    current,
    baseline([101, 1755], [330, 5390], { packages: { [notes]: entry(1000, 50) } }),
    settings,
  );
  assert.deepEqual(next?.packages, { [notes]: entry(1000, 40) });
});

test("parseBaseline checks the package entries and formatBaseline sorts them", () => {
  const rows = baseline([101, 1755], [330, 5390], {
    packages: { [`${apps}/tasks-core`]: entry(500, 20), [`${apps}/notes-core`]: entry(1000, 50) },
  });
  const text = formatBaseline(rows);
  assert.deepEqual(parseBaseline(text), rows);
  assert.ok(text.indexOf("notes-core") < text.indexOf("tasks-core"));

  const { packages: _packages, ...withoutPackages } = rows;
  assert.throws(() => parseBaseline(JSON.stringify(withoutPackages)), /baseline: packages must be an object/);
  assert.throws(
    () => parseBaseline(JSON.stringify({ ...rows, packages: { x: { cloneCoverage: 1, duplicatedLines: 1.5 } } })),
    /baseline: x duplicatedLines must be a non-negative integer/,
  );
  assert.throws(
    () => parseBaseline(JSON.stringify({ ...rows, packages: { x: { cloneCoverage: 101, duplicatedLines: 1 } } })),
    /baseline: x cloneCoverage must be a percentage from 0 to 100/,
  );
});

test("the committed baseline parses and lists only packages with copied lines", () => {
  const committed = parseBaseline(
    readFileSync(new URL("./duplicate-code-baseline.json", import.meta.url), "utf8"),
  );
  const keys = Object.keys(committed.packages);
  assert.ok(keys.length > 0);
  for (const key of keys) {
    assert.ok(key === apps || key === api || key.startsWith(`${apps}/`) || key.startsWith(`${api}/`), key);
    assert.ok(committed.packages[key].duplicatedLines > 0, key);
  }
});

test("summaryMarkdown shows the scope totals and lists grown packages first", () => {
  const notes = `${apps}/notes-core`;
  const tasks = `${apps}/tasks-core`;
  const meet = `${apps}/meet-core`;
  const rows = baseline([101, 1755], [330, 5390], {
    packages: { [notes]: entry(1000, 50), [tasks]: entry(100, 30) },
  });
  const current = {
    [api]: { clones: 330, duplicatedLines: 5390 },
    [apps]: { clones: 102, duplicatedLines: 1770 },
  };
  const comparison = comparePackages(
    { [notes]: pkg(1000, 60), [tasks]: pkg(100, 30), [meet]: pkg(300, 0) },
    rows.packages,
  );
  const markdown = summaryMarkdown({
    jscpdVersion: "4.3.0",
    baseline: rows,
    current,
    errors: [`${apps}: clones grew from 101 to 102`],
    comparison,
  });
  assert.match(markdown, /^## Copied code \(jscpd 4\.3\.0, 70 tokens \/ 10 lines\)/);
  assert.match(markdown, /\*\*The scope check failed\*\* \(1\): packages\/apps\/src: clones grew from 101 to 102/);
  assert.match(markdown, /\| `packages\/apps\/src` \| 102 \| 1770 \| 101 \/ 1755 \|/);
  assert.match(markdown, /1 package grew, 0 dropped; 1 package without copied lines is not listed\./);
  const notesRow = markdown.indexOf(`| \`${notes}\` | 6% | 60 | 1000 | +10 ⚠️ |`);
  const tasksRow = markdown.indexOf(`| \`${tasks}\` | 30% | 30 | 100 | = |`);
  assert.ok(notesRow > 0 && tasksRow > notesRow, "a grown package comes before a higher share");
  assert.ok(!markdown.includes(meet));
});
