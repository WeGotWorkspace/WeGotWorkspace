#!/usr/bin/env node
/**
 * Locks the nightly live Playwright workflow to issue #1022:
 * five existing specs, real backend config, schedule + manual dispatch, no PR CI.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

const LIVE_SPECS = [
  "notes-offline-sync.spec.ts",
  "docs-offline-sync.spec.ts",
  "docs-home-browse.spec.ts",
  "calendar-offline-week-event.spec.ts",
  "meet-adhoc-two-users.spec.ts",
];

function readRepo(relativePath) {
  return readFileSync(path.join(repoRoot, relativePath), "utf8");
}

describe("nightly live e2e workflow", () => {
  const workflow = readRepo(".github/workflows/nightly-live-e2e.yml");
  const liveConfig = readRepo("packages/apps/playwright.live.config.mjs");
  const liveTier = readRepo("packages/apps/e2e/live-tier.mjs");
  const ci = readRepo(".github/workflows/ci.yml");

  it("runs the five existing live specs and skips drive-offline-sync", () => {
    for (const spec of LIVE_SPECS) {
      assert.equal(
        existsSync(path.join(repoRoot, "packages/apps/e2e", spec)),
        true,
        `missing packages/apps/e2e/${spec}`,
      );
      assert.match(workflow, new RegExp(`e2e/${spec}`));
      const stem = spec.replace(/\.spec\.ts$/, "");
      assert.match(liveTier, new RegExp(stem));
    }
    assert.equal(workflow.includes("drive-offline-sync"), false);
    assert.equal(
      existsSync(
        path.join(repoRoot, "packages/apps/e2e/drive-offline-sync.spec.ts"),
      ),
      false,
    );
  });

  it("uses the live Playwright config against the host API, not Docker or the mock tier", () => {
    assert.match(workflow, /playwright\.live\.config\.mjs/);
    assert.match(workflow, /php packages\/api\/artisan wgw:dev-install/);
    assert.match(workflow, /127\.0\.0\.1:9080/);
    assert.equal(workflow.includes("docker compose"), false);
    assert.equal(workflow.includes("localhost:8080"), false);
    assert.equal(workflow.includes("playwright.config.mjs"), false);
    assert.match(liveConfig, /pnpm --filter @wgw\/apps run dev:app/);
    assert.match(liveConfig, /http:\/\/127\.0\.0\.1:9080\/api\/v1\/health/);
    assert.equal(liveConfig.includes("bash -lc"), false);
  });

  it("is nightly and manually dispatchable, and is not a pull-request check", () => {
    assert.match(workflow, /cron: "0 3 \* \* \*"/);
    assert.match(workflow, /workflow_dispatch:/);
    assert.equal(workflow.includes("pull_request:"), false);
    assert.equal(workflow.includes("merge_group:"), false);
    assert.match(workflow, /node-version: "24"/);
    assert.doesNotMatch(ci, /nightly-live-e2e\.yml:\s*\n\s*uses:/);
  });

  it("uploads failure artifacts and files a GitHub issue", () => {
    assert.match(workflow, /actions\/upload-artifact@v7/);
    assert.match(workflow, /name: live-e2e-artifacts/);
    assert.match(workflow, /if: failure\(\)/);
    assert.match(workflow, /issues\.create/);
    assert.match(workflow, /Nightly live e2e failed/);
    assert.match(workflow, /issues: write/);
  });
});
