import assert from "node:assert/strict";
import test from "node:test";
import { writeFileSync, mkdtempSync, rmSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";

import { extractMajorVersion, checkVitestVersions } from "./check-vitest-versions.mjs";

test("extractMajorVersion parses caret ranges", () => {
  assert.equal(extractMajorVersion("^4.1.11"), 4);
  assert.equal(extractMajorVersion("^5.0.1"), 5);
  assert.equal(extractMajorVersion("^10.2.3"), 10);
});

test("extractMajorVersion parses tilde ranges", () => {
  assert.equal(extractMajorVersion("~4.1.11"), 4);
  assert.equal(extractMajorVersion("~5.0.0"), 5);
});

test("extractMajorVersion parses exact versions", () => {
  assert.equal(extractMajorVersion("4.1.11"), 4);
  assert.equal(extractMajorVersion("5.0.1"), 5);
});

test("extractMajorVersion returns null for invalid input", () => {
  assert.equal(extractMajorVersion(""), null);
  assert.equal(extractMajorVersion(null), null);
  assert.equal(extractMajorVersion(undefined), null);
  assert.equal(extractMajorVersion("latest"), null);
});

test("checkVitestVersions passes when versions align", () => {
  const tmpDir = mkdtempSync(path.join(tmpdir(), "vitest-check-"));
  const pkgPath = path.join(tmpDir, "package.json");
  
  try {
    const pkg = {
      devDependencies: {
        vitest: "^4.1.11",
        "@vitest/coverage-v8": "^4.1.11",
        "@vitest/browser-playwright": "^4.2.0",
      },
    };
    writeFileSync(pkgPath, JSON.stringify(pkg, null, 2));
    
    const result = checkVitestVersions(pkgPath);
    assert.equal(result.ok, true);
    assert.equal(result.errors.length, 0);
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("checkVitestVersions fails when @vitest/* package has wrong major", () => {
  const tmpDir = mkdtempSync(path.join(tmpdir(), "vitest-check-"));
  const pkgPath = path.join(tmpDir, "package.json");
  
  try {
    const pkg = {
      devDependencies: {
        vitest: "^4.1.11",
        "@vitest/coverage-v8": "^5.0.1",
      },
    };
    writeFileSync(pkgPath, JSON.stringify(pkg, null, 2));
    
    const result = checkVitestVersions(pkgPath);
    assert.equal(result.ok, false);
    assert.equal(result.errors.length, 1);
    assert.match(result.errors[0], /@vitest\/coverage-v8.*major 5.*vitest.*major 4/);
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("checkVitestVersions fails when multiple @vitest/* packages mismatch", () => {
  const tmpDir = mkdtempSync(path.join(tmpdir(), "vitest-check-"));
  const pkgPath = path.join(tmpDir, "package.json");
  
  try {
    const pkg = {
      devDependencies: {
        vitest: "^4.1.11",
        "@vitest/coverage-v8": "^5.0.1",
        "@vitest/browser-playwright": "^3.0.0",
      },
    };
    writeFileSync(pkgPath, JSON.stringify(pkg, null, 2));
    
    const result = checkVitestVersions(pkgPath);
    assert.equal(result.ok, false);
    assert.equal(result.errors.length, 2);
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("checkVitestVersions fails when vitest is missing", () => {
  const tmpDir = mkdtempSync(path.join(tmpdir(), "vitest-check-"));
  const pkgPath = path.join(tmpDir, "package.json");
  
  try {
    const pkg = {
      devDependencies: {
        "@vitest/coverage-v8": "^4.1.11",
      },
    };
    writeFileSync(pkgPath, JSON.stringify(pkg, null, 2));
    
    const result = checkVitestVersions(pkgPath);
    assert.equal(result.ok, false);
    assert.match(result.errors[0], /vitest dependency not found/);
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("checkVitestVersions handles file read errors", () => {
  const result = checkVitestVersions("/nonexistent/path/package.json");
  assert.equal(result.ok, false);
  assert.equal(result.errors.length, 1);
  assert.match(result.errors[0], /Failed to read/);
});
