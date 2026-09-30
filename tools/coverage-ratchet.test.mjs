#!/usr/bin/env node
/**
 * Tests for coverage-ratchet.mjs
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import {
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  rmSync,
  unlinkSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
let tempDir;

before(() => {
  tempDir = path.join(tmpdir(), `coverage-ratchet-test-${Date.now()}`);
  mkdirSync(tempDir, { recursive: true });
  mkdirSync(path.join(tempDir, "tools"), { recursive: true });
  mkdirSync(path.join(tempDir, "packages/apps/coverage"), { recursive: true });
  mkdirSync(path.join(tempDir, "packages/api/build/logs"), { recursive: true });
});

after(() => {
  if (tempDir) {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

function runCheck() {
  return execSync("node tools/coverage-ratchet.mjs check", {
    cwd: repoRoot,
    encoding: "utf8",
    env: { ...process.env, COVERAGE_RATCHET_ROOT: tempDir },
  });
}

function runCheckExpectFail() {
  try {
    execSync("node tools/coverage-ratchet.mjs check", {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: "pipe",
      env: { ...process.env, COVERAGE_RATCHET_ROOT: tempDir },
    });
    throw new Error("Expected check to fail");
  } catch (err) {
    if (err.message === "Expected check to fail") throw err;
    return { status: err.status, stdout: err.stdout, stderr: err.stderr };
  }
}

function runUpdate() {
  return execSync("node tools/coverage-ratchet.mjs update", {
    cwd: repoRoot,
    encoding: "utf8",
    env: { ...process.env, COVERAGE_RATCHET_ROOT: tempDir },
  });
}

function setBaseline(data) {
  writeFileSync(
    path.join(tempDir, "tools/coverage-baseline.json"),
    JSON.stringify(data, null, 2),
  );
}

function getBaseline() {
  return JSON.parse(
    readFileSync(path.join(tempDir, "tools/coverage-baseline.json"), "utf8"),
  );
}

function setAppsCoverage(data) {
  writeFileSync(
    path.join(tempDir, "packages/apps/coverage/coverage-summary.json"),
    JSON.stringify(data, null, 2),
  );
}

function setApiCoverage(xml) {
  writeFileSync(path.join(tempDir, "packages/api/build/logs/clover.xml"), xml);
}

describe("coverage-ratchet", () => {
  it("check passes when coverage is unchanged", () => {
    setBaseline({ "packages/apps/src/button": 80.0 });
    setAppsCoverage({
      "packages/apps/src/button/src/button.tsx": {
        lines: { covered: 160, total: 200 },
      },
    });
    setApiCoverage(
      `<?xml version="1.0"?><coverage><project></project></coverage>`,
    );

    const result = runCheck();
    assert.match(result, /✅ Coverage ratchet check passed/);
  });

  it("check fails when coverage drops > 0.5% (>= 50 statements)", () => {
    setBaseline({ "packages/apps/src/button": 82.0 });
    setAppsCoverage({
      "packages/apps/src/button/src/button.tsx": {
        lines: { covered: 150, total: 200 },
      },
    });
    setApiCoverage(
      `<?xml version="1.0"?><coverage><project></project></coverage>`,
    );

    const result = runCheckExpectFail();
    assert.equal(result.status, 1);
    assert.match(result.stderr, /❌ Coverage ratchet check failed/);
    assert.match(result.stderr, /dropped from 82\.00% to 75\.00%/);
  });

  it("check warns but does not fail when coverage drops for small packages (< 50 statements)", () => {
    setBaseline({ "packages/apps/src/small": 85.0 });
    setAppsCoverage({
      "packages/apps/src/small/index.tsx": {
        lines: { covered: 20, total: 30 },
      },
    });
    setApiCoverage(
      `<?xml version="1.0"?><coverage><project></project></coverage>`,
    );

    const result = runCheck();
    assert.match(result, /⚠️  Warnings:/);
    assert.match(
      result,
      /small: coverage dropped.*\(< 50 statements, not enforced\)/,
    );
    assert.match(result, /✅ Coverage ratchet check passed/);
  });

  it("check proposes a baseline when a package is missing from current coverage", () => {
    setBaseline({
      "packages/apps/src/deleted-pkg": 80.0,
      "packages/apps/src/button": 80.0,
    });
    setAppsCoverage({
      "packages/apps/src/button/src/button.tsx": {
        lines: { covered: 160, total: 200 },
      },
    });
    setApiCoverage(
      `<?xml version="1.0"?><coverage><project></project></coverage>`,
    );

    const result = runCheckExpectFail();
    assert.equal(result.status, 2);
    assert.match(result.stdout, /⚠️  Warnings:/);
    assert.match(
      result.stdout,
      /deleted-pkg: package missing from current coverage/,
    );
    assert.match(result.stdout, /✅ Coverage ratchet check passed/);
  });

  it("exits 3 before comparing when clover is missing and apps coverage dropped", () => {
    setBaseline({ "packages/apps/src/button": 82.0 });
    setAppsCoverage({
      "packages/apps/src/button/src/button.tsx": {
        lines: { covered: 150, total: 200 },
      },
    });
    const cloverPath = path.join(tempDir, "packages/api/build/logs/clover.xml");
    if (existsSync(cloverPath)) unlinkSync(cloverPath);

    const result = runCheckExpectFail();
    assert.equal(result.status, 3);
    assert.match(result.stderr, /API coverage report is missing or unreadable/);
    assert.doesNotMatch(result.stderr, /Coverage ratchet check failed/);
  });

  it("exits 1 when one package drops and another rises", () => {
    setBaseline({
      "packages/apps/src/button": 82.0,
      "packages/apps/src/callout": 70.0,
    });
    setAppsCoverage({
      "packages/apps/src/button/src/button.tsx": {
        lines: { covered: 150, total: 200 },
      },
      "packages/apps/src/callout/src/callout.tsx": {
        lines: { covered: 90, total: 100 },
      },
    });
    setApiCoverage(
      `<?xml version="1.0"?><coverage><project></project></coverage>`,
    );

    const result = runCheckExpectFail();
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Coverage ratchet check failed/);
    assert.match(
      result.stderr,
      /button: coverage dropped from 82\.00% to 75\.00%/,
    );
    assert.match(result.stdout, /callout: 70\.00% → 90\.00%/);
  });

  it("check exits with code 2 when coverage increases or new packages appear", () => {
    setBaseline({ "packages/apps/src/button": 75.0 });
    setAppsCoverage({
      "packages/apps/src/button/src/button.tsx": {
        lines: { covered: 170, total: 200 },
      },
      "packages/apps/src/new-pkg/index.tsx": {
        lines: { covered: 80, total: 100 },
      },
    });
    setApiCoverage(
      `<?xml version="1.0"?><coverage><project></project></coverage>`,
    );

    const result = runCheckExpectFail();
    assert.equal(result.status, 2);
    assert.match(result.stdout, /📈 Coverage increases detected/);
    assert.match(result.stdout, /button: 75\.00% → 85\.00%/);
    assert.match(result.stdout, /📦 New packages detected/);
    assert.match(result.stdout, /new-pkg: 80\.00%/);
  });

  it("update writes current coverage to baseline", () => {
    setBaseline({});
    setAppsCoverage({
      "packages/apps/src/button/src/button.tsx": {
        lines: { covered: 160, total: 200 },
      },
      "packages/apps/src/callout/src/callout.tsx": {
        lines: { covered: 90, total: 100 },
      },
    });
    setApiCoverage(`<?xml version="1.0"?>
<coverage>
  <project>
    <file name="/workspace/packages/api/app/Services/Auth/LoginService.php">
      <metrics statements="200" coveredstatements="150"/>
    </file>
  </project>
</coverage>`);

    runUpdate();

    const baseline = getBaseline();
    assert.equal(baseline["packages/api/app/Services/Auth"], 75.0);
    assert.equal(baseline["packages/apps/src/button"], 80.0);
    assert.equal(baseline["packages/apps/src/callout"], 90.0);
  });

  it("uses the file-level clover metrics when a file has multiple classes", () => {
    setBaseline({});
    setAppsCoverage({});
    setApiCoverage(`<?xml version="1.0" encoding="UTF-8"?>
<coverage generated="1">
  <project timestamp="1">
    <file name="/workspace/packages/api/app/Services/Demo/TwoClassService.php">
      <class name="App\\Services\\Demo\\FirstClass" namespace="App\\Services\\Demo">
        <metrics complexity="1" methods="1" coveredmethods="1" conditionals="0" coveredconditionals="0" statements="10" coveredstatements="10" elements="11" coveredelements="11"/>
      </class>
      <class name="App\\Services\\Demo\\SecondClass" namespace="App\\Services\\Demo">
        <metrics complexity="2" methods="2" coveredmethods="0" conditionals="0" coveredconditionals="0" statements="90" coveredstatements="0" elements="92" coveredelements="0"/>
      </class>
      <line num="12" type="stmt" count="1"/>
      <metrics loc="120" ncloc="100" classes="2" methods="3" coveredmethods="1" conditionals="0" coveredconditionals="0" statements="100" coveredstatements="10" elements="103" coveredelements="11"/>
    </file>
    <file name="/workspace/packages/api/app/Services/Demo/OtherService.php">
      <class name="App\\Services\\Demo\\Other" namespace="App\\Services\\Demo">
        <metrics complexity="1" methods="1" coveredmethods="1" conditionals="0" coveredconditionals="0" statements="5" coveredstatements="5" elements="6" coveredelements="6"/>
      </class>
      <metrics statements="40" coveredstatements="20" loc="10" ncloc="8" classes="1" methods="1" coveredmethods="1" conditionals="0" coveredconditionals="0" elements="41" coveredelements="21"/>
    </file>
    <file name="/workspace/packages/api/app/Services/Demo/ClassOnlyService.php">
      <class name="App\\Services\\Demo\\ClassOnly" namespace="App\\Services\\Demo">
        <metrics complexity="1" methods="1" coveredmethods="1" conditionals="0" coveredconditionals="0" statements="10" coveredstatements="10" elements="11" coveredelements="11"/>
      </class>
    </file>
  </project>
</coverage>
<metrics loc="1" ncloc="1" statements="100" coveredstatements="0"/>`);

    runUpdate();

    const baseline = getBaseline();
    // 10/100 + 20/40 + 10/10 = 40/150 = 26.666... → 26.67
    // The stray metrics after </file> must not turn the third file into 0/100.
    assert.equal(baseline["packages/api/app/Services/Demo"], 26.67);
  });

  it("parses Clover XML without xml2js (dependency-free)", () => {
    setBaseline({});
    setAppsCoverage({});
    setApiCoverage(`<?xml version="1.0"?>
<coverage>
  <project>
    <file name="/workspace/packages/api/app/Services/Drive/FileService.php">
      <metrics statements="150" coveredstatements="120"/>
    </file>
    <file name="/workspace/packages/api/app/Services/Drive/FolderService.php">
      <metrics statements="100" coveredstatements="90"/>
    </file>
  </project>
</coverage>`);

    runUpdate();

    const baseline = getBaseline();
    // (120 + 90) / (150 + 100) = 210 / 250 = 84%
    assert.equal(baseline["packages/api/app/Services/Drive"], 84.0);
  });

  it("excludes mail-core and Services/Mail exactly", () => {
    setBaseline({});
    setAppsCoverage({
      "packages/apps/src/mail-core/src/mail.tsx": {
        lines: { covered: 50, total: 100 },
      },
    });
    setApiCoverage(`<?xml version="1.0"?>
<coverage>
  <project>
    <file name="/workspace/packages/api/app/Services/Mail/MailService.php">
      <metrics statements="100" coveredstatements="80"/>
    </file>
    <file name="/workspace/packages/api/app/Services/MailDelivery/PasswordResetMailFactory.php">
      <metrics statements="50" coveredstatements="45"/>
    </file>
  </project>
</coverage>`);

    runUpdate();

    const baseline = getBaseline();
    assert.equal(baseline["packages/apps/src/mail-core"], undefined);
    assert.equal(baseline["packages/api/app/Services/Mail"], undefined);
    assert.equal(baseline["packages/api/app/Services/MailDelivery"], 90.0);
  });

  it("handles absolute file paths in coverage-summary.json", () => {
    setBaseline({});
    setAppsCoverage({
      "/home/runner/work/WeGotWorkspace/WeGotWorkspace/packages/apps/src/button/src/button.tsx":
        {
          lines: { covered: 160, total: 200 },
        },
    });
    setApiCoverage(
      `<?xml version="1.0"?><coverage><project></project></coverage>`,
    );

    runUpdate();

    const baseline = getBaseline();
    assert.equal(baseline["packages/apps/src/button"], 80.0);
  });

  it("update keeps the higher baseline when the report dipped under the threshold", () => {
    setBaseline({
      "packages/apps/src/button": 80.0,
      "packages/apps/src/callout": 70.0,
      "packages/apps/src/gone": 50.0,
    });
    setAppsCoverage({
      "packages/apps/src/button/src/button.tsx": {
        lines: { covered: 159, total: 200 },
      },
      "packages/apps/src/callout/src/callout.tsx": {
        lines: { covered: 90, total: 100 },
      },
      "packages/apps/src/fresh/index.tsx": {
        lines: { covered: 40, total: 100 },
      },
    });
    setApiCoverage(
      `<?xml version="1.0"?><coverage><project></project></coverage>`,
    );

    runUpdate();

    const baseline = getBaseline();
    assert.equal(baseline["packages/apps/src/button"], 80.0);
    assert.equal(baseline["packages/apps/src/callout"], 90.0);
    assert.equal(baseline["packages/apps/src/fresh"], 40.0);
    assert.equal(baseline["packages/apps/src/gone"], undefined);
  });

  it("check --json prints the report on stdout and keeps the exit code", () => {
    setBaseline({ "packages/apps/src/button": 75.0 });
    setAppsCoverage({
      "packages/apps/src/button/src/button.tsx": {
        lines: { covered: 170, total: 200 },
      },
    });
    setApiCoverage(
      `<?xml version="1.0"?><coverage><project></project></coverage>`,
    );

    let status = 0;
    let stdout = "";
    let stderr = "";
    try {
      stdout = execSync("node tools/coverage-ratchet.mjs check --json", {
        cwd: repoRoot,
        encoding: "utf8",
        env: { ...process.env, COVERAGE_RATCHET_ROOT: tempDir },
      });
    } catch (err) {
      status = err.status;
      stdout = err.stdout;
      stderr = err.stderr;
    }

    assert.equal(status, 2);
    const report = JSON.parse(stdout);
    assert.deepEqual(report.increases, [
      { pkg: "packages/apps/src/button", from: 75, to: 85 },
    ]);
    assert.equal(report.errors.length, 0);
    assert.match(stderr, /Coverage increases detected/);
    assert.doesNotMatch(stdout, /Coverage increases detected/);
  });

  it("the coverage-ratchet job checks once and does not expand the report body", () => {
    const yml = readFileSync(
      path.join(repoRoot, ".github/workflows/ci.yml"),
      "utf8",
    );
    const start = yml.indexOf("\n  coverage-ratchet:");
    assert.notEqual(start, -1);
    const job = yml.slice(start);
    const checks = job.match(/node tools\/coverage-ratchet\.mjs check/g) ?? [];
    assert.equal(checks.length, 1);
    assert.match(job, /check --json/);
    assert.equal(job.includes("pnpm/action-setup"), false);
    assert.equal(job.includes("REPORT="), false);
    assert.match(job, /--body-file/);
    assert.match(job, /printf '%s\\n' '`{3}'/);
  });

  it("aggregates lib/<sub> packages separately", () => {
    setBaseline({});
    setAppsCoverage({
      "packages/apps/src/lib/calendar-elements/EventCard/EventCard.tsx": {
        lines: { covered: 100, total: 150 },
      },
      "packages/apps/src/lib/calendar-elements/TimeLine/TimeLine.tsx": {
        lines: { covered: 50, total: 50 },
      },
      "packages/apps/src/lib/workspace-app-icon.tsx": {
        lines: { covered: 20, total: 20 },
      },
    });
    setApiCoverage(
      `<?xml version="1.0"?><coverage><project></project></coverage>`,
    );

    runUpdate();

    const baseline = getBaseline();
    // calendar-elements: (100+50)/(150+50) = 75%
    assert.equal(baseline["packages/apps/src/lib/calendar-elements"], 75.0);
    // workspace-app-icon is a single file, needs at least 2 path segments under lib
    assert.equal(
      baseline["packages/apps/src/lib/workspace-app-icon"],
      undefined,
    );
  });
});
