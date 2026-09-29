#!/usr/bin/env node
/**
 * Tests for coverage-ratchet.mjs
 */
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const baselinePath = path.join(repoRoot, "tools/coverage-baseline.json");
const appsCoveragePath = path.join(repoRoot, "packages/apps/coverage/coverage-summary.json");
const apiCoveragePath = path.join(repoRoot, "packages/api/build/logs/clover.xml");

let originalBaseline;
let originalAppsCoverage;
let originalApiCoverage;

function backup(filePath) {
  return existsSync(filePath) ? readFileSync(filePath, "utf8") : null;
}

function restore(filePath, content) {
  if (content) {
    writeFileSync(filePath, content);
  } else if (existsSync(filePath)) {
    rmSync(filePath);
  }
}

beforeEach(() => {
  originalBaseline = backup(baselinePath);
  originalAppsCoverage = backup(appsCoveragePath);
  originalApiCoverage = backup(apiCoveragePath);
});

afterEach(() => {
  restore(baselinePath, originalBaseline);
  restore(appsCoveragePath, originalAppsCoverage);
  restore(apiCoveragePath, originalApiCoverage);
});

describe("coverage-ratchet", () => {
  it("check passes when coverage is unchanged", () => {
    writeFileSync(baselinePath, JSON.stringify({ "packages/apps/src/button": 80.5 }, null, 2));
    
    const appsCoverage = {
      "packages/apps/src/button/src/button.tsx": { lines: { covered: 161, total: 200 } }
    };
    mkdirSync(path.dirname(appsCoveragePath), { recursive: true });
    writeFileSync(appsCoveragePath, JSON.stringify(appsCoverage, null, 2));
    
    const clover = `<?xml version="1.0"?>
<coverage>
  <project>
  </project>
</coverage>`;
    mkdirSync(path.dirname(apiCoveragePath), { recursive: true });
    writeFileSync(apiCoveragePath, clover);

    const result = execSync("node tools/coverage-ratchet.mjs check", { cwd: repoRoot, encoding: "utf8" });
    assert.match(result, /✅ Coverage ratchet check passed/);
  });

  it("check fails when coverage drops > 0.5% (>= 50 statements)", () => {
    writeFileSync(baselinePath, JSON.stringify({ "packages/apps/src/button": 82.0 }, null, 2));
    
    const appsCoverage = {
      "packages/apps/src/button/src/button.tsx": { lines: { covered: 150, total: 200 } }
    };
    mkdirSync(path.dirname(appsCoveragePath), { recursive: true });
    writeFileSync(appsCoveragePath, JSON.stringify(appsCoverage, null, 2));
    
    const clover = `<?xml version="1.0"?>
<coverage>
  <project>
  </project>
</coverage>`;
    mkdirSync(path.dirname(apiCoveragePath), { recursive: true });
    writeFileSync(apiCoveragePath, clover);

    assert.throws(() => {
      execSync("node tools/coverage-ratchet.mjs check", { cwd: repoRoot, encoding: "utf8", stdio: "pipe" });
    }, (err) => {
      assert.match(err.stderr, /❌ Coverage ratchet check failed/);
      assert.match(err.stderr, /dropped from 82\.00% to 75\.00%/);
      return true;
    });
  });

  it("check warns but does not fail when coverage drops for small packages (< 50 statements)", () => {
    writeFileSync(baselinePath, JSON.stringify({ "packages/apps/src/small": 85.0 }, null, 2));
    
    const appsCoverage = {
      "packages/apps/src/small/index.tsx": { lines: { covered: 20, total: 30 } }
    };
    mkdirSync(path.dirname(appsCoveragePath), { recursive: true });
    writeFileSync(appsCoveragePath, JSON.stringify(appsCoverage, null, 2));
    
    const clover = `<?xml version="1.0"?>
<coverage>
  <project>
  </project>
</coverage>`;
    mkdirSync(path.dirname(apiCoveragePath), { recursive: true });
    writeFileSync(apiCoveragePath, clover);

    const result = execSync("node tools/coverage-ratchet.mjs check", { cwd: repoRoot, encoding: "utf8" });
    assert.match(result, /⚠️  Warnings:/);
    assert.match(result, /small: coverage dropped.*\(< 50 statements, not enforced\)/);
    assert.match(result, /✅ Coverage ratchet check passed/);
  });

  it("check warns when baseline package is missing from current coverage", () => {
    writeFileSync(baselinePath, JSON.stringify({ "packages/apps/src/deleted-pkg": 80.0 }, null, 2));
    
    const appsCoverage = {
      "packages/apps/src/button/src/button.tsx": { lines: { covered: 160, total: 200 } }
    };
    mkdirSync(path.dirname(appsCoveragePath), { recursive: true });
    writeFileSync(appsCoveragePath, JSON.stringify(appsCoverage, null, 2));
    
    const clover = `<?xml version="1.0"?>
<coverage>
  <project>
  </project>
</coverage>`;
    mkdirSync(path.dirname(apiCoveragePath), { recursive: true });
    writeFileSync(apiCoveragePath, clover);

    const result = execSync("node tools/coverage-ratchet.mjs check", { cwd: repoRoot, encoding: "utf8" });
    assert.match(result, /⚠️  Warnings:/);
    assert.match(result, /deleted-pkg: package missing from current coverage/);
    assert.match(result, /✅ Coverage ratchet check passed/);
  });

  it("check exits with code 2 when coverage increases", () => {
    writeFileSync(baselinePath, JSON.stringify({ "packages/apps/src/button": 75.0 }, null, 2));
    
    const appsCoverage = {
      "packages/apps/src/button/src/button.tsx": { lines: { covered: 170, total: 200 } }
    };
    mkdirSync(path.dirname(appsCoveragePath), { recursive: true });
    writeFileSync(appsCoveragePath, JSON.stringify(appsCoverage, null, 2));
    
    const clover = `<?xml version="1.0"?>
<coverage>
  <project>
  </project>
</coverage>`;
    mkdirSync(path.dirname(apiCoveragePath), { recursive: true });
    writeFileSync(apiCoveragePath, clover);

    try {
      execSync("node tools/coverage-ratchet.mjs check", { cwd: repoRoot, encoding: "utf8", stdio: "pipe" });
      assert.fail("Should have exited with code 2");
    } catch (err) {
      assert.equal(err.status, 2);
      assert.match(err.stdout, /📈 Coverage increases detected/);
      assert.match(err.stdout, /button: 75\.00% → 85\.00%/);
    }
  });

  it("update writes current coverage to baseline", () => {
    const appsCoverage = {
      "packages/apps/src/button/src/button.tsx": { lines: { covered: 160, total: 200 } },
      "packages/apps/src/callout/src/callout.tsx": { lines: { covered: 90, total: 100 } }
    };
    mkdirSync(path.dirname(appsCoveragePath), { recursive: true });
    writeFileSync(appsCoveragePath, JSON.stringify(appsCoverage, null, 2));
    
    const clover = `<?xml version="1.0"?>
<coverage>
  <project>
    <file name="/workspace/packages/api/app/Services/Auth/LoginService.php">
      <metrics statements="200" coveredstatements="150"/>
    </file>
  </project>
</coverage>`;
    mkdirSync(path.dirname(apiCoveragePath), { recursive: true });
    writeFileSync(apiCoveragePath, clover);

    execSync("node tools/coverage-ratchet.mjs update", { cwd: repoRoot });

    const baseline = JSON.parse(readFileSync(baselinePath, "utf8"));
    assert.equal(baseline["packages/api/app/Services/Auth"], 75.0);
    assert.equal(baseline["packages/apps/src/button"], 80.0);
    assert.equal(baseline["packages/apps/src/callout"], 90.0);
  });

  it("parses Clover XML without xml2js (dependency-free)", () => {
    const clover = `<?xml version="1.0"?>
<coverage>
  <project>
    <file name="/workspace/packages/api/app/Services/Drive/FileService.php">
      <metrics statements="150" coveredstatements="120"/>
    </file>
    <file name="/workspace/packages/api/app/Services/Drive/FolderService.php">
      <metrics statements="100" coveredstatements="90"/>
    </file>
  </project>
</coverage>`;
    mkdirSync(path.dirname(apiCoveragePath), { recursive: true });
    writeFileSync(apiCoveragePath, clover);
    
    const appsCoverage = {};
    mkdirSync(path.dirname(appsCoveragePath), { recursive: true });
    writeFileSync(appsCoveragePath, JSON.stringify(appsCoverage, null, 2));

    execSync("node tools/coverage-ratchet.mjs update", { cwd: repoRoot });

    const baseline = JSON.parse(readFileSync(baselinePath, "utf8"));
    // (120 + 90) / (150 + 100) = 210 / 250 = 84%
    assert.equal(baseline["packages/api/app/Services/Drive"], 84.0);
  });

  it("excludes mail-core and Services/Mail*", () => {
    const appsCoverage = {
      "packages/apps/src/mail-core/src/mail.tsx": { lines: { covered: 50, total: 100 } }
    };
    mkdirSync(path.dirname(appsCoveragePath), { recursive: true });
    writeFileSync(appsCoveragePath, JSON.stringify(appsCoverage, null, 2));
    
    const clover = `<?xml version="1.0"?>
<coverage>
  <project>
    <file name="/workspace/packages/api/app/Services/Mail/MailService.php">
      <metrics statements="100" coveredstatements="80"/>
    </file>
  </project>
</coverage>`;
    mkdirSync(path.dirname(apiCoveragePath), { recursive: true });
    writeFileSync(apiCoveragePath, clover);

    execSync("node tools/coverage-ratchet.mjs update", { cwd: repoRoot });

    const baseline = JSON.parse(readFileSync(baselinePath, "utf8"));
    assert.equal(baseline["packages/apps/src/mail-core"], undefined);
    assert.equal(baseline["packages/api/app/Services/Mail"], undefined);
  });
});
