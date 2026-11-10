#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");
const apiRoot = resolve(repoRoot, "packages/api");
const policyPath = resolve(__dirname, "license-policy.json");
const policy = JSON.parse(readFileSync(policyPath, "utf8"));

const violations = [];

function normalizeLicenseExpression(expression) {
  return expression.trim().replace(/[()]/g, "").replace(/\s+/g, " ");
}

function matchesDeniedIdentifier(identifier) {
  const normalized = normalizeLicenseExpression(identifier);
  return policy.deniedLicenseIdentifiers.some((denied) => normalized === denied);
}

function matchesAllowedIdentifier(identifier) {
  const normalized = normalizeLicenseExpression(identifier);
  return policy.allowedLicenseIdentifiers.includes(normalized);
}

function isAllowedCompoundExpression(expression) {
  const normalized = normalizeLicenseExpression(expression);
  return policy.allowedCompoundExpressions.some(
    (allowed) => normalizeLicenseExpression(allowed) === normalized,
  );
}

function isLicenseAllowed(licenseExpression) {
  const normalized = normalizeLicenseExpression(licenseExpression);
  if (normalized === "" || normalized === "UNKNOWN") {
    return false;
  }

  if (isAllowedCompoundExpression(normalized)) {
    return true;
  }

  if (normalized.includes(" OR ")) {
    return normalized.split(" OR ").every((part) => !matchesDeniedIdentifier(part))
      && normalized.split(" OR ").some((part) => matchesAllowedIdentifier(part));
  }

  if (normalized.includes(" AND ")) {
    return normalized.split(" AND ").every((part) => matchesAllowedIdentifier(part));
  }

  if (matchesDeniedIdentifier(normalized)) {
    return false;
  }

  return matchesAllowedIdentifier(normalized);
}

function matchesDeniedPackage(name) {
  return policy.deniedPackagePatterns.some((pattern) => new RegExp(pattern).test(name));
}

function recordViolation(source, name, license, reason) {
  violations.push({ source, name, license, reason });
}

function checkPackageName(source, name) {
  if (matchesDeniedPackage(name)) {
    recordViolation(source, name, "", "package matches deniedPackagePatterns");
  }
}

/**
 * A package whose declared license is vague but whose LICENSE text was checked
 * by hand. The override only applies while the declared value is unchanged.
 */
function overriddenLicense(name, expression) {
  const override = policy.packageLicenseOverrides?.[name];
  if (!override || normalizeLicenseExpression(expression) !== override.declared) {
    return expression;
  }
  return override.license;
}

function checkLicense(source, name, licenseExpression) {
  checkPackageName(source, name);

  let expression = licenseExpression;
  if (Array.isArray(licenseExpression)) {
    expression = licenseExpression.join(" OR ");
  }
  expression = overriddenLicense(name, String(expression));

  if (!isLicenseAllowed(String(expression))) {
    recordViolation(source, name, String(expression), "license is not allowed by tools/license-policy.json");
  }
}

function checkPnpmProductionLicenses() {
  const output = execFileSync("pnpm", ["licenses", "list", "--json", "--prod"], {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });

  const data = JSON.parse(output);
  for (const [license, packages] of Object.entries(data)) {
    for (const pkg of packages) {
      checkLicense("pnpm", pkg.name, pkg.license ?? license);
    }
  }
}

function checkComposerProductionLicenses() {
  const output = execFileSync("composer", ["licenses", "--no-dev", "--format=json"], {
    cwd: apiRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });

  const data = JSON.parse(output);
  for (const [name, info] of Object.entries(data.dependencies ?? {})) {
    checkLicense("composer", name, info.license ?? []);
  }
}

try {
  checkPnpmProductionLicenses();
  checkComposerProductionLicenses();
} catch (error) {
  console.error("license-check: failed to inspect dependencies");
  if (error instanceof Error) {
    console.error(error.message);
    if ("stdout" in error && error.stdout) {
      console.error(String(error.stdout));
    }
    if ("stderr" in error && error.stderr) {
      console.error(String(error.stderr));
    }
  }
  process.exit(1);
}

if (violations.length > 0) {
  console.error(`license-check: found ${violations.length} violation(s)\n`);
  for (const violation of violations) {
    console.error(
      `- [${violation.source}] ${violation.name}${violation.license ? ` (${violation.license})` : ""}: ${violation.reason}`,
    );
  }
  console.error("\nUpdate tools/license-policy.json only after legal review.");
  process.exit(1);
}

console.log("license-check: OK (production JS + PHP dependencies)");
