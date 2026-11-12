import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, renameSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  coverageScope,
  gitChangedPaths,
  scopeForPaths,
} from "./coverage-scope.mjs";

const never = () => {
  throw new Error("no diff expected");
};

describe("scopeForPaths", () => {
  it("an API-only change runs only the API side", () => {
    assert.deepEqual(
      scopeForPaths(["packages/api/app/Services/Drive/DriveService.php"]),
      { api: true, apps: false },
    );
  });

  it("an apps-only change runs only the apps side", () => {
    assert.deepEqual(scopeForPaths(["packages/apps/src/lib/api/client.ts"]), {
      api: false,
      apps: true,
    });
  });

  it("a change outside both packages runs both", () => {
    for (const file of [
      ".github/workflows/ci.yml",
      "pnpm-lock.yaml",
      "tools/coverage-baseline.json",
      "packages/openapi-types/generated/schema.ts",
    ]) {
      assert.deepEqual(scopeForPaths([file]), { api: true, apps: true }, file);
    }
  });

  it("agent docs and docs change nothing", () => {
    assert.deepEqual(
      scopeForPaths([".agents/skills/testing/SKILL.md", "docs/install.md"]),
      { api: false, apps: false },
    );
  });
});

describe("coverageScope", () => {
  it("a push to main runs both without a diff", () => {
    assert.deepEqual(
      coverageScope({ event: "push", labels: [], changedPaths: never }),
      { api: true, apps: true },
    );
  });

  it("the merge queue follows the diff", () => {
    assert.deepEqual(
      coverageScope({
        event: "merge_group",
        labels: [],
        changedPaths: () => ["packages/api/app/Http/Kernel.php"],
      }),
      { api: true, apps: false },
    );
  });

  it("a pull request without a coverage label runs neither", () => {
    assert.deepEqual(
      coverageScope({
        event: "pull_request",
        labels: ["ready-for-human"],
        changedPaths: never,
      }),
      { api: false, apps: false },
    );
  });

  it("run-apps-coverage runs the apps side without a diff", () => {
    assert.deepEqual(
      coverageScope({
        event: "pull_request",
        labels: ["run-apps-coverage"],
        changedPaths: never,
      }),
      { api: false, apps: true },
    );
  });

  it("run-full-ci follows the diff, and run-apps-coverage adds the apps side", () => {
    const changedPaths = () => ["packages/api/routes/api.php"];
    assert.deepEqual(
      coverageScope({
        event: "pull_request",
        labels: ["run-full-ci"],
        changedPaths,
      }),
      { api: true, apps: false },
    );
    assert.deepEqual(
      coverageScope({
        event: "pull_request",
        labels: ["run-full-ci", "run-apps-coverage"],
        changedPaths,
      }),
      { api: true, apps: true },
    );
  });
});

describe("gitChangedPaths", () => {
  it("lists both sides of a cross-package rename", () => {
    const dir = mkdtempSync(join(tmpdir(), "scope-"));
    const git = (...args) =>
      execFileSync("git", ["-C", dir, ...args], { encoding: "utf8" }).trim();
    git("init", "-q");
    mkdirSync(join(dir, "packages/apps/src/lib/api"), { recursive: true });
    mkdirSync(join(dir, "packages/api/app/Services/Drive"), {
      recursive: true,
    });
    const from = "packages/apps/src/lib/api/client.ts";
    const to = "packages/api/app/Services/Drive/client.php";
    writeFileSync(join(dir, from), "export const a = 1;\n".repeat(20));
    git("add", "-A");
    git("-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "a");
    const base = git("rev-parse", "HEAD");
    renameSync(join(dir, from), join(dir, to));
    git("add", "-A");
    git("-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "b");
    const head = git("rev-parse", "HEAD");

    const cwd = process.cwd();
    process.chdir(dir);
    let paths;
    try {
      paths = gitChangedPaths(base, head);
    } finally {
      process.chdir(cwd);
    }
    assert.deepEqual(scopeForPaths(paths), { api: true, apps: true });
  });
});
