#!/usr/bin/env node
/**
 * Vitest version alignment guard.
 *
 * Ensures all @vitest/* dependencies in packages/apps/package.json have the
 * same major version as vitest itself. Mixed majors cause coverage errors like
 * "AssertionError: coverageFilesDirectory is required".
 *
 * Usage:
 *   check-vitest-versions.mjs [path-to-package.json]
 *
 * Exits 0 when versions align, 1 when mismatched.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const defaultPackageJsonPath = path.join(repoRoot, "packages/apps/package.json");

/**
 * Extract major version from a semver range like "^4.1.11" or "~5.0.0".
 * Returns null if the version string doesn't contain a parseable number.
 */
export function extractMajorVersion(versionRange) {
  if (!versionRange || typeof versionRange !== "string") return null;
  const match = versionRange.match(/(\d+)/);
  return match ? parseInt(match[1], 10) : null;
}

/**
 * Check if all @vitest/* packages have the same major version as vitest.
 * Returns { ok: true } or { ok: false, errors: [...] }.
 */
export function checkVitestVersions(packageJsonPath) {
  const errors = [];
  
  let pkgJson;
  try {
    const content = readFileSync(packageJsonPath, "utf8");
    pkgJson = JSON.parse(content);
  } catch (err) {
    errors.push(`Failed to read or parse ${packageJsonPath}: ${err.message}`);
    return { ok: false, errors };
  }

  const deps = { ...pkgJson.dependencies, ...pkgJson.devDependencies };
  
  const vitestVersion = deps.vitest;
  if (!vitestVersion) {
    errors.push("vitest dependency not found in package.json");
    return { ok: false, errors };
  }

  const vitestMajor = extractMajorVersion(vitestVersion);
  if (vitestMajor === null) {
    errors.push(`Could not parse vitest version: ${vitestVersion}`);
    return { ok: false, errors };
  }

  const vitestPackages = Object.keys(deps).filter((name) => name.startsWith("@vitest/"));
  
  for (const pkg of vitestPackages) {
    const version = deps[pkg];
    const major = extractMajorVersion(version);
    
    if (major === null) {
      errors.push(`Could not parse ${pkg} version: ${version}`);
      continue;
    }
    
    if (major !== vitestMajor) {
      errors.push(
        `Version mismatch: ${pkg} is at major ${major} (${version}) but vitest is at major ${vitestMajor} (${vitestVersion})`
      );
    }
  }

  return { ok: errors.length === 0, errors };
}

// CLI entry point
if (import.meta.url === `file://${process.argv[1]}`) {
  const packageJsonPath = process.argv[2] || defaultPackageJsonPath;
  const result = checkVitestVersions(packageJsonPath);
  
  if (!result.ok) {
    console.error("❌ Vitest version check failed:\n");
    for (const error of result.errors) {
      console.error(`  ${error}`);
    }
    console.error("\nAll @vitest/* packages must have the same major version as vitest.");
    console.error("See .github/dependabot.yml for the Dependabot guard that prevents this.");
    process.exit(1);
  }
  
  console.log("✅ Vitest versions are aligned");
  process.exit(0);
}
