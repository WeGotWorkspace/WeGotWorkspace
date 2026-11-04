import assert from "node:assert/strict";
import test from "node:test";

import {
  archiveMoves,
  buildReport,
  collectEntries,
  daysBetween,
  docStatus,
  formatMarkdown,
  linkedIssue,
  livePlanReferences,
  movedPath,
  newestDateUnder,
  parseArgs,
  parseLastCommitDates,
  rewriteMarkdown,
  specStatus,
} from "./report-doc-staleness.mjs";

const repo = "Owner/Repo";

test("the Source line names the linked issue, in this repo or another", () => {
  assert.deepEqual(linkedIssue("12-x", "Source: #34 (body-hash: abcdef12)\n", repo), { repo, number: 34 });
  assert.deepEqual(linkedIssue("673-x", "Source: Other/Product#89 (body-hash: abcdef12)\n", repo), {
    repo: "Other/Product",
    number: 89,
  });
  assert.deepEqual(linkedIssue("000-x", "Source: #793 (ad-hoc folder)\n", repo), { repo, number: 793 });
});

test("an ad-hoc spec has no issue, even when its folder has a number", () => {
  assert.equal(linkedIssue("000-x", "Source: ad-hoc\n", repo), null);
  assert.equal(linkedIssue("55-x", "Source: ad-hoc — no issue yet\n", repo), null);
});

test("without a Source line the folder number is the issue, and 000 is none", () => {
  assert.deepEqual(linkedIssue("55-x", null, repo), { repo, number: 55 });
  assert.deepEqual(linkedIssue("55-x", "# Spec without header\n", repo), { repo, number: 55 });
  assert.equal(linkedIssue("000-x", null, repo), null);
  assert.equal(linkedIssue("no-number", null, repo), null);
});

test("git log output gives the newest date per file", () => {
  const output = "\0" + "2026-10-02\n\na/one.md\n" + "\0" + "2026-09-01\n\na/one.md\na/two.md\n";
  const dates = parseLastCommitDates(output);
  assert.equal(dates.get("a/one.md"), "2026-10-02");
  assert.equal(dates.get("a/two.md"), "2026-09-01");
});

test("a directory is as new as its newest file, and a sibling prefix does not count", () => {
  const dates = new Map([
    ["s/12-x/spec.md", "2026-08-01"],
    ["s/12-x/plan.md", "2026-08-20"],
    ["s/12-xy/plan.md", "2026-10-01"],
  ]);
  assert.equal(newestDateUnder(dates, "s/12-x"), "2026-08-20");
  assert.equal(newestDateUnder(dates, "s/99-none"), null);
});

test("days are counted between calendar dates", () => {
  assert.equal(daysBetween("2026-09-05", "2026-11-04"), 60);
  assert.equal(daysBetween("2026-11-04", "2026-11-04"), 0);
});

test("entries are spec folders and markdown docs; the template and loose files are skipped", () => {
  const { specs, docs } = collectEntries([
    ".agents/specs/README.md",
    ".agents/specs/_template/spec.md",
    ".agents/specs/12-x/spec.md",
    ".agents/specs/12-x/plan.md",
    ".agents/specs/archive/2026/9-old/spec.md",
    ".agents/plans/legacy.md",
    "docs/a.md",
    "docs/archive/old-plan.md",
    "docs/image.png",
  ]);
  assert.deepEqual(specs, [
    { path: ".agents/specs/12-x", name: "12-x", archived: false },
    { path: ".agents/specs/archive/2026/9-old", name: "9-old", archived: true },
  ]);
  assert.deepEqual(
    docs.map((doc) => [doc.path, doc.archived]),
    [
      [".agents/plans/legacy.md", false],
      ["docs/a.md", false],
      ["docs/archive/old-plan.md", true],
    ],
  );
});

test("only a closed issue untouched for 60 days is an archive candidate", () => {
  const issue = { repo, number: 1 };
  assert.equal(specStatus({ archived: false, issue, state: "CLOSED", ageDays: 60 }), "archive");
  assert.equal(specStatus({ archived: false, issue, state: "CLOSED", ageDays: 59 }), "closed-recent");
  assert.equal(specStatus({ archived: false, issue, state: "OPEN", ageDays: 400 }), "open");
  assert.equal(specStatus({ archived: false, issue, state: "MERGED", ageDays: 90 }), "archive");
  assert.equal(specStatus({ archived: false, issue, state: "MISSING", ageDays: 400 }), "missing");
  assert.equal(specStatus({ archived: false, issue, state: null, ageDays: 400 }), "unknown");
  assert.equal(specStatus({ archived: false, issue: null, state: null, ageDays: 400 }), "no-issue");
  assert.equal(specStatus({ archived: true, issue, state: "CLOSED", ageDays: 400 }), "archived");
});

test("a doc untouched for 60 days is stale; an archived doc is not", () => {
  assert.equal(docStatus({ archived: false, ageDays: 60 }), "stale");
  assert.equal(docStatus({ archived: false, ageDays: 10 }), "current");
  assert.equal(docStatus({ archived: true, ageDays: 400 }), "archived");
});

function sampleReport({ codeReferences = new Map() } = {}) {
  return buildReport({
    trackedFiles: [
      ".agents/specs/10-old/spec.md",
      ".agents/specs/11-held/spec.md",
      ".agents/specs/12-new/spec.md",
      ".agents/specs/13-open/spec.md",
      ".agents/specs/000-adhoc/spec.md",
      "docs/plan.md",
    ],
    dates: new Map([
      [".agents/specs/10-old/spec.md", "2025-08-01"],
      [".agents/specs/11-held/spec.md", "2026-08-01"],
      [".agents/specs/12-new/spec.md", "2026-10-30"],
      [".agents/specs/13-open/spec.md", "2026-01-01"],
      [".agents/specs/000-adhoc/spec.md", "2026-01-01"],
      ["docs/plan.md", "2026-06-01"],
    ]),
    specTexts: new Map([[".agents/specs/000-adhoc", "Source: ad-hoc\n"]]),
    issueStates: new Map([
      ["owner/repo#10", "CLOSED"],
      ["owner/repo#11", "CLOSED"],
      ["owner/repo#12", "CLOSED"],
      ["owner/repo#13", "OPEN"],
    ]),
    codeReferences,
    now: "2026-11-04",
    defaultRepo: repo,
  });
}

test("the report gives each spec its date, issue state and status", () => {
  const report = sampleReport();
  const byName = new Map(report.specs.map((spec) => [spec.name, spec]));
  assert.equal(byName.get("10-old").status, "archive");
  assert.equal(byName.get("10-old").lastCommit, "2025-08-01");
  assert.equal(byName.get("12-new").status, "closed-recent");
  assert.equal(byName.get("13-open").status, "open");
  assert.equal(byName.get("000-adhoc").status, "no-issue");
  assert.equal(report.docs[0].status, "stale");
});

test("a candidate that code mentions is held back and not moved", () => {
  const report = sampleReport({ codeReferences: new Map([["11-held", ["src/a.php"]]]) });
  assert.deepEqual(archiveMoves(report), [
    { from: ".agents/specs/10-old", to: ".agents/specs/archive/2025/10-old" },
  ]);
  const markdown = formatMarkdown(report, repo);
  assert.match(markdown, /- Archive now: 1/);
  assert.match(markdown, /- Archive candidates held back \(code or a live plan\.md mentions them\): 1/);
  assert.match(markdown, /`src\/a\.php`/);
});

test("the archive year is the year of the last commit", () => {
  const moves = archiveMoves(sampleReport());
  assert.ok(moves.some((move) => move.to === ".agents/specs/archive/2026/11-held"));
});

const moves = [{ from: ".agents/specs/10-old", to: ".agents/specs/archive/2025/10-old" }];

test("moved paths keep the part below the moved folder", () => {
  assert.equal(movedPath(".agents/specs/10-old/plan.md", moves), ".agents/specs/archive/2025/10-old/plan.md");
  assert.equal(movedPath(".agents/specs/10-older/plan.md", moves), ".agents/specs/10-older/plan.md");
});

test("links from a moved spec are re-resolved from its new folder", () => {
  const text = "[skill](../../skills/x/SKILL.md) [plan](plan.md) [doc](../../../docs/a.md#part) [web](https://x.test/a)";
  const next = rewriteMarkdown(
    text,
    ".agents/specs/10-old/spec.md",
    ".agents/specs/archive/2025/10-old/spec.md",
    moves,
  );
  assert.equal(
    next,
    "[skill](../../../../skills/x/SKILL.md) [plan](plan.md) [doc](../../../../../docs/a.md#part) [web](https://x.test/a)",
  );
});

test("links and written-out paths into a moved spec follow it", () => {
  const text = [
    "See [plan](../../.agents/specs/10-old/plan.md) and `.agents/specs/10-old/tasks.md`.",
    "Not [this](../../.agents/specs/10-older/plan.md) or `.agents/specs/10-older/`.",
    "[ref]: ../../.agents/specs/10-old/",
  ].join("\n");
  const next = rewriteMarkdown(text, "docs/architecture/a.md", "docs/architecture/a.md", moves);
  assert.equal(
    next,
    [
      "See [plan](../../.agents/specs/archive/2025/10-old/plan.md) and `.agents/specs/archive/2025/10-old/tasks.md`.",
      "Not [this](../../.agents/specs/10-older/plan.md) or `.agents/specs/10-older/`.",
      "[ref]: ../../.agents/specs/archive/2025/10-old/",
    ].join("\n"),
  );
});

test("a root-level link written as a repo path is rewritten once", () => {
  const next = rewriteMarkdown("[s](.agents/specs/10-old/spec.md)", "AGENTS.md", "AGENTS.md", moves);
  assert.equal(next, "[s](.agents/specs/archive/2025/10-old/spec.md)");
});

test("a file with nothing to move is returned unchanged", () => {
  const text = "[a](../b.md) `.agents/specs/12-new/`";
  assert.equal(rewriteMarkdown(text, "docs/x/a.md", "docs/x/a.md", moves), text);
});

test("arguments are parsed and a bad date is refused", () => {
  assert.deepEqual(parseArgs(["--", "--json", "--offline", "--now=2026-11-04", "--repo=a/b"]), {
    json: true,
    offline: true,
    archive: false,
    now: "2026-11-04",
    repo: "a/b",
  });
  assert.throws(() => parseArgs(["--now=yesterday"]), /YYYY-MM-DD/);
  assert.throws(() => parseArgs(["--fail"]), /unknown argument/);
});

test("a live plan that would need a rewrite holds the candidate back", () => {
  const candidates = [
    { path: ".agents/specs/10-old", name: "10-old", lastCommit: "2025-08-01" },
    { path: ".agents/specs/11-also-old", name: "11-also-old", lastCommit: "2025-08-01" },
  ];
  const livePlans = new Map([
    [".agents/specs/20-live/plan.md", "Phase 2 lives in `.agents/specs/10-old/`.\n"],
    [".agents/specs/21-live/plan.md", "Nothing to see.\n"],
    [".agents/specs/11-also-old/plan.md", "See [old](../10-old/plan.md).\n"],
  ]);
  assert.deepEqual([...livePlanReferences(candidates, livePlans)], [["10-old", [".agents/specs/20-live/plan.md"]]]);
});
