#!/usr/bin/env node

import { createHash, createSign } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { createApiPackageCopyFilter } from "../packages/api/scripts/api-package-copy-filter.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");
const appRoot = resolve(repoRoot, "apps/wegotworkspace");
const outputRoot = resolve(repoRoot, "dist/releases");
const stagingRoot = resolve(outputRoot, "wgw-release");

const version = resolveVersion();
const packageName = `wegotworkspace-deploy-${version}.zip`;
const packagePath = resolve(outputRoot, packageName);
const manifestPath = resolve(outputRoot, "manifest.json");
const signaturePath = resolve(outputRoot, "manifest.sig");

const appReleaseEntries = [
  ".htaccess",
  "example.htaccess",
  ".user.ini",
  "index.php",
  "bootstrap",
  "VERSION",
  "wgw-config.sample.php",
  "packages/apps/admin/dist",
  "packages/apps/drive/dist",
  "packages/apps/install/dist",
  "packages/apps/mail/dist",
  "packages/apps/notes/dist",
  "packages/apps/shell/dist",
  "packages/apps/settings/dist",
  "packages/apps/meet/dist",
  "packages/apps/contacts/dist",
  "packages/apps/tasks/dist",
];
const repoReleaseEntries = ["packages/api"];

ensureDir(outputRoot);
rmSafe(stagingRoot);
ensureDir(stagingRoot);

for (const entry of appReleaseEntries) {
  const source = resolve(appRoot, entry);
  if (!existsSync(source)) {
    throw new Error(`Missing release input: ${relative(repoRoot, source)}`);
  }
  const target = resolve(stagingRoot, entry);
  ensureDir(dirname(target));
  cpSync(source, target, { recursive: true });
}

for (const file of readdirSync(appRoot)) {
  if (
    file === "index.html" ||
    file === "sw.js" ||
    (file.startsWith("workbox-") && file.endsWith(".js"))
  ) {
    cpSync(resolve(appRoot, file), resolve(stagingRoot, file));
  }
}

for (const entry of repoReleaseEntries) {
  const source = resolve(repoRoot, entry);
  if (!existsSync(source)) {
    throw new Error(`Missing release input: ${relative(repoRoot, source)}`);
  }
  const target = resolve(stagingRoot, entry);
  ensureDir(dirname(target));
  cpSync(source, target, {
    recursive: true,
    filter: createApiPackageCopyFilter(source, { forRelease: true }),
  });
}
const rootDocs = ["INSTALL.md", "README.md", "LICENSE", "THIRD_PARTY_NOTICES.md"];
for (const file of rootDocs) {
  const source = resolve(repoRoot, file);
  if (!existsSync(source)) {
    throw new Error(`Missing release input: ${file}`);
  }
  cpSync(source, resolve(stagingRoot, file));
}
writeFileSync(resolve(stagingRoot, "VERSION"), `${version}\n`, "utf8");

zipDirectory(stagingRoot, packagePath);
const checksum = sha256File(packagePath);
let checksumSignature = "";
const privateKey = process.env.WGW_RELEASE_SIGNING_PRIVATE_KEY?.trim() ?? "";
if (privateKey !== "") {
  const checksumSigner = createSign("RSA-SHA256");
  checksumSigner.update(checksum);
  checksumSigner.end();
  checksumSignature = checksumSigner.sign(privateKey).toString("base64");
}

const manifest = {
  name: "wegotworkspace",
  version,
  package_name: packageName,
  package_url: "",
  checksum_sha256: checksum,
  checksum_signature: checksumSignature,
  min_php: "8.3.0",
  min_schema: 1,
  released_at: new Date().toISOString(),
  notes_url: "",
};
const manifestContent = `${JSON.stringify(manifest, null, 2)}\n`;
writeFileSync(manifestPath, manifestContent, "utf8");

if (privateKey !== "") {
  const signer = createSign("RSA-SHA256");
  signer.update(manifestContent);
  signer.end();
  const signature = signer.sign(privateKey).toString("base64");
  writeFileSync(signaturePath, `${signature}\n`, "utf8");
}

rmSafe(stagingRoot);
console.log(`Release assets written to ${relative(repoRoot, outputRoot)}`);

function resolveVersion() {
  const fromEnv = process.env.WGW_RELEASE_VERSION?.trim();
  if (fromEnv) {
    return normalizeVersion(fromEnv);
  }
  const versionFile = resolve(appRoot, "VERSION");
  if (!existsSync(versionFile)) {
    throw new Error("apps/wegotworkspace/VERSION is missing");
  }
  const fromFile = readFileSync(versionFile, "utf8").trim();
  if (!fromFile) {
    throw new Error("apps/wegotworkspace/VERSION is empty");
  }
  return normalizeVersion(fromFile);
}

function normalizeVersion(version) {
  const trimmed = version.trim();
  if (trimmed.startsWith("v")) {
    return trimmed.slice(1);
  }
  return trimmed;
}

function ensureDir(path) {
  mkdirSync(path, { recursive: true });
}

function rmSafe(path) {
  try {
    execFileSync("rm", ["-rf", path], { stdio: "ignore" });
  } catch {
    // no-op
  }
}

function zipDirectory(sourceDir, outputZip) {
  const cwd = sourceDir;
  rmSafe(outputZip);
  execFileSync("zip", ["-rq", outputZip, "."], { cwd, stdio: "inherit" });
}

function sha256File(path) {
  const hash = createHash("sha256");
  const data = readFileSync(path);
  hash.update(data);
  return hash.digest("hex");
}

