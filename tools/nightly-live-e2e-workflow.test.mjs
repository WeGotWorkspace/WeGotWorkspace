#!/usr/bin/env node
/**
 * The live Playwright webServer must start Vite from @wgw/apps.
 * A login shell drops setup-node and setup-php from PATH on GitHub runners.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("live Playwright webServer", () => {
  const liveConfig = readFileSync(
    path.join(repoRoot, "packages/apps/playwright.live.config.mjs"),
    "utf8",
  );

  it("starts the apps Vite dev server without a login shell", () => {
    assert.match(liveConfig, /pnpm --filter @wgw\/apps run dev:app/);
    assert.equal(liveConfig.includes("bash -lc"), false);
  });
});
