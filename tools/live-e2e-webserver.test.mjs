#!/usr/bin/env node
/**
 * The live Playwright webServer must start Vite from @wgw/apps.
 * A login shell drops setup-node and setup-php from PATH on GitHub runners.
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { liveTierSpecPattern } from "../packages/apps/e2e/live-tier.mjs";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

describe("live Playwright webServer", () => {
  const liveConfig = readFileSync(
    path.join(repoRoot, "packages/apps/playwright.live.config.mjs"),
    "utf8",
  );

  it("starts the apps Vite dev server without a login shell", () => {
    assert.match(liveConfig, /pnpm --filter @wgw\/apps run dev:app/);
    assert.equal(liveConfig.includes("bash -lc"), false);
  });

  it("runs the chaos suite in parallel on that same stack", () => {
    const chaosConfig = readFileSync(
      path.join(repoRoot, "packages/apps/playwright.chaos.config.mjs"),
      "utf8",
    );
    assert.match(chaosConfig, /playwright\.live\.config\.mjs/);
    assert.match(chaosConfig, /fullyParallel:\s*true/);
    assert.match(chaosConfig, /workers:\s*2/);
    assert.equal(chaosConfig.includes("bash -lc"), false);
  });

  it("gives every live spec a fresh API budget per test (#1677)", () => {
    const e2eDir = path.join(repoRoot, "packages/apps/e2e");
    const liveSpecs = readdirSync(e2eDir).filter((name) =>
      liveTierSpecPattern.test(name),
    );
    assert.ok(liveSpecs.length > 0, "live-tier pattern matches no spec");
    const fromPlaywright = liveSpecs.filter((name) =>
      /from\s+["']@playwright\/test["']/.test(
        readFileSync(path.join(e2eDir, name), "utf8"),
      ),
    );
    assert.deepEqual(
      fromPlaywright,
      [],
      "import from ./helpers/live-test instead",
    );
  });
});
