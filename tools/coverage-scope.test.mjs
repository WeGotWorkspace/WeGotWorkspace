import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { coverageScope, scopeForPaths } from "./coverage-scope.mjs";

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
