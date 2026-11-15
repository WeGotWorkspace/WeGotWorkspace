import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  classify,
  parseNumstat,
  renderMarkdown,
  summarize,
  COMMENT_MARKER,
} from "./pr-line-delta.mjs";

describe("classify", () => {
  const cases = {
    test: [
      "packages/apps/src/lib/api/client.test.ts",
      "packages/apps/src/drive/upload.spec.tsx",
      "packages/apps/src/button/button.stories.tsx",
      "packages/apps/src/notes/__tests__/sync.ts",
      "packages/apps/src/lib/ui/stories/Gallery.tsx",
      "packages/api/tests/Feature/Installer/DataDirInstallTest.php",
      "packages/api/tests/Support/WgwInstallFixture.php",
      "tools/api-e2e/e2e/install.fresh.spec.ts",
      "packages/apps/e2e/drive.ts",
      "packages/apps/src/lib/fixtures/calendar.json",
      "packages/api/app/Support/SomethingTest.php",
    ],
    other: [
      "pnpm-lock.yaml",
      "packages/api/composer.lock",
      "packages/openapi-types/generated/schema.d.ts",
      ".agents/skills/api/SKILL.md",
      "docs/install.md",
      "packages/apps/README.md",
      ".github/workflows/ci.yml",
      "INSTALL.md",
    ],
    source: [
      "packages/api/app/Services/Drive/DriveService.php",
      "packages/apps/src/lib/api/client.ts",
      "tools/file-size-ratchet.mjs",
      "packages/api/routes/api.php",
    ],
  };
  for (const [kind, files] of Object.entries(cases)) {
    for (const file of files) {
      it(`${file} is ${kind}`, () => assert.equal(classify(file), kind));
    }
  }
});

describe("parseNumstat", () => {
  it("reads plain rows, binary files and renames", () => {
    const raw = [
      "3\t1\tpackages/apps/src/a.ts",
      "-\t-\tpackages/apps/public/logo.png",
      "2\t2\t",
      "packages/apps/src/old.ts",
      "packages/apps/src/new.test.ts",
      "",
    ].join("\0");

    assert.deepEqual(parseNumstat(raw), [
      { path: "packages/apps/src/a.ts", added: 3, deleted: 1 },
      { path: "packages/apps/public/logo.png", added: 0, deleted: 0 },
      { path: "packages/apps/src/new.test.ts", added: 2, deleted: 2 },
    ]);
  });

  it("an empty diff has no rows", () => {
    assert.deepEqual(parseNumstat(""), []);
  });
});

describe("summarize and renderMarkdown", () => {
  it("splits by kind and area and shows a negative source net", () => {
    const summary = summarize([
      { path: "packages/apps/src/lib/sync.ts", added: 10, deleted: 300 },
      { path: "packages/apps/src/lib/sync.test.ts", added: 50, deleted: 40 },
      { path: "packages/api/app/Http/Kernel.php", added: 4, deleted: 0 },
      { path: "pnpm-lock.yaml", added: 7, deleted: 7 },
    ]);

    assert.deepEqual(summary.total.source, { added: 14, deleted: 300 });
    assert.deepEqual(summary.total.test, { added: 50, deleted: 40 });
    assert.deepEqual(summary.byArea["packages/api"].source, {
      added: 4,
      deleted: 0,
    });

    const markdown = renderMarkdown(summary);
    assert.ok(markdown.startsWith(COMMENT_MARKER));
    assert.match(markdown, /\*\*Source net −286\*\*, test net \+10/);
    assert.match(markdown, /\| source \| \+14 \| −300 \| −286 \|/);
    assert.match(markdown, /\| packages\/apps \| −290 \| \+10 \| 0 \|/);
    assert.match(markdown, /\| other \| 0 \| 0 \| 0 \|/);
  });
});

describe("CI wiring", () => {
  const yml = readFileSync(
    new URL("../../.github/workflows/ci.yml", import.meta.url),
    "utf8",
  );
  const start = yml.indexOf("\n  pr-line-delta:");
  const job = yml.slice(start, yml.indexOf("\n  # ", start + 1));

  it("runs on pull requests only and comments only on same-repository ones", () => {
    assert.notEqual(start, -1);
    assert.match(job, /github\.event_name == 'pull_request'/);
    assert.match(job, /pull-requests: write/);
    assert.match(job, /head\.repo\.full_name == github\.repository/);
    assert.match(job, /GITHUB_STEP_SUMMARY/);
  });
});
