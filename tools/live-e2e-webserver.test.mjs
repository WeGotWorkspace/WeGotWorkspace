#!/usr/bin/env node
/**
 * The live Playwright webServer must start Vite from @wgw/apps.
 * A login shell drops setup-node and setup-php from PATH on GitHub runners.
 */
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  liveTierSpecPattern,
  liveTierSpecs,
} from "../packages/apps/e2e/live-tier.mjs";

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

describe("live-tier spec list", () => {
  const e2eDir = path.join(repoRoot, "packages/apps/e2e");

  it("is in alphabetical order with no duplicates", () => {
    // Sorted, one name per line: two PRs that each add a spec touch
    // different lines and merge without a conflict.
    const sorted = [...new Set(liveTierSpecs)].sort();
    assert.deepEqual(
      liveTierSpecs,
      sorted,
      "keep liveTierSpecs in packages/apps/e2e/live-tier.mjs sorted, one name per line",
    );
  });

  it("names an existing spec file for every entry", () => {
    for (const name of liveTierSpecs) {
      assert.match(
        name,
        /^[a-z0-9-]+$/,
        `plain spec name, no .spec.ts: ${name}`,
      );
      assert.ok(
        existsSync(path.join(e2eDir, `${name}.spec.ts`)),
        `missing packages/apps/e2e/${name}.spec.ts`,
      );
    }
  });

  it("builds the pattern from that list", () => {
    for (const name of liveTierSpecs) {
      assert.ok(liveTierSpecPattern.test(`${name}.spec.ts`), name);
    }
    assert.equal(liveTierSpecPattern.test("notes-sync-matrix.spec.ts"), false);
    assert.equal(liveTierSpecPattern.test("rtc-chaos.spec.ts"), false);
  });

  it("keeps one name per line in the source", () => {
    const source = readFileSync(path.join(e2eDir, "live-tier.mjs"), "utf8");
    const body = source.match(/export const liveTierSpecs = \[\n([^\]]*)\];/);
    assert.ok(body, "liveTierSpecs array literal not found");
    const lines = body[1].split("\n").filter((line) => line.trim() !== "");
    assert.deepEqual(
      lines,
      liveTierSpecs.map((name) => `  "${name}",`),
      'write each entry as `  "name",` on its own line',
    );
  });
});
