#!/usr/bin/env node
// Publish a built release to an update channel feed.
//
// Each non-stable channel is a rolling GitHub prerelease named
// `channel-<name>` whose manifest.json is overwritten on every publish:
//
//   https://github.com/<repo>/releases/download/channel-beta/manifest.json
//   https://github.com/<repo>/releases/download/channel-edge/manifest.json
//
// Stable needs no rolling release: it is GitHub's releases/latest.
//
// Usage:
//   node tools/publish-release-channel.mjs <channel> <release-dir> [asset ...]
//
// <release-dir> holds manifest.json (and manifest.sig when signed). Extra
// assets (the deploy ZIP, Docker install files) are uploaded first, so the
// manifest never points at a file that is not there yet. A manifest older
// than the one already on the channel is not published.

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const PUBLISHED_CHANNELS = ["beta", "edge"];

/**
 * Semver 2.0 precedence. Returns <0, 0 or >0.
 * A leading "v" is ignored. Build metadata (+...) is ignored.
 */
export function compareVersions(a, b) {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  for (let i = 0; i < 3; i++) {
    if (pa.core[i] !== pb.core[i]) {
      return pa.core[i] - pb.core[i];
    }
  }
  if (pa.pre.length === 0 || pb.pre.length === 0) {
    return pb.pre.length - pa.pre.length;
  }
  const n = Math.max(pa.pre.length, pb.pre.length);
  for (let i = 0; i < n; i++) {
    const x = pa.pre[i];
    const y = pb.pre[i];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    const xNum = /^\d+$/.test(x);
    const yNum = /^\d+$/.test(y);
    if (xNum && yNum) {
      const d = Number(x) - Number(y);
      if (d !== 0) return d;
    } else if (xNum !== yNum) {
      return xNum ? -1 : 1;
    } else if (x !== y) {
      return x < y ? -1 : 1;
    }
  }
  return 0;
}

function parseVersion(version) {
  const trimmed = String(version).trim().replace(/^v/, "").split("+")[0];
  const dash = trimmed.indexOf("-");
  const core = (dash === -1 ? trimmed : trimmed.slice(0, dash))
    .split(".")
    .map((part) => Number(part));
  if (
    core.length !== 3 ||
    core.some((part) => !Number.isInteger(part) || part < 0)
  ) {
    throw new Error(`not a semver version: ${version}`);
  }
  const pre = dash === -1 ? [] : trimmed.slice(dash + 1).split(".");
  return { core, pre };
}

export function channelTag(channel) {
  if (!PUBLISHED_CHANNELS.includes(channel)) {
    throw new Error(
      `unknown channel "${channel}" (expected one of: ${PUBLISHED_CHANNELS.join(", ")})`,
    );
  }
  return `channel-${channel}`;
}

const DEPLOY_ZIP = /^wegotworkspace-deploy-(.+)\.zip$/;

/**
 * Deploy ZIPs on the channel release to delete after a publish.
 *
 * Keeps the ZIPs the new manifest uses plus the newest older one: an install
 * that checked before this publish applies the package_url it stored then,
 * so that ZIP must outlive one more publish.
 */
export function staleZipAssets(assetNames, keepNames) {
  const keep = new Set(keepNames);
  const older = assetNames
    .filter((name) => DEPLOY_ZIP.test(name) && !keep.has(name))
    .sort((a, b) => compareZipVersions(b, a));
  return older.slice(1);
}

function compareZipVersions(a, b) {
  try {
    return compareVersions(DEPLOY_ZIP.exec(a)[1], DEPLOY_ZIP.exec(b)[1]);
  } catch {
    // A name that is not a version sorts as oldest.
    return a < b ? -1 : a > b ? 1 : 0;
  }
}

function gh(args, options = {}) {
  return execFileSync("gh", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
    ...options,
  });
}

/** Asset names on a release, or null when the release does not exist. */
function releaseAssetNames(tag) {
  try {
    const out = gh(
      ["release", "view", tag, "--json", "assets", "--jq", ".assets[].name"],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    return out.split("\n").filter((line) => line !== "");
  } catch (error) {
    if (/release not found/i.test(String(error.stderr ?? ""))) {
      return null;
    }
    // Any other failure (network, auth) must stop the publish: treating it
    // as "nothing published" would let an older manifest replace a newer one.
    process.stderr.write(String(error.stderr ?? ""));
    throw error;
  }
}

/** Version the channel offers now, or null when it has no manifest yet. */
function publishedVersion(tag) {
  if (!(releaseAssetNames(tag) ?? []).includes("manifest.json")) {
    return null;
  }
  const raw = gh([
    "release",
    "download",
    tag,
    "--pattern",
    "manifest.json",
    "--output",
    "-",
  ]);
  const version = JSON.parse(raw).version;
  if (typeof version !== "string" || version === "") {
    throw new Error(`${tag} manifest.json has no version`);
  }
  return version;
}

function ensureChannelRelease(tag, channel) {
  if (releaseAssetNames(tag) !== null) {
    return;
  }
  gh([
    "release",
    "create",
    tag,
    "--prerelease",
    "--latest=false",
    "--title",
    `${channel[0].toUpperCase()}${channel.slice(1)} channel`,
    "--notes",
    `Rolling feed for the ${channel} update channel. Do not download from here by hand.`,
  ]);
}

function main(argv) {
  const [channel, releaseDir, ...assets] = argv;
  if (!channel || !releaseDir) {
    console.error(
      "usage: publish-release-channel.mjs <channel> <release-dir> [asset ...]",
    );
    process.exit(2);
  }
  const tag = channelTag(channel);
  const manifestPath = resolve(releaseDir, "manifest.json");
  const signaturePath = resolve(releaseDir, "manifest.sig");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const version = String(manifest.version ?? "");
  if (version === "") {
    throw new Error(`${manifestPath} has no version`);
  }

  ensureChannelRelease(tag, channel);
  const current = publishedVersion(tag);
  if (current !== null && compareVersions(version, current) <= 0) {
    console.log(`${tag} already offers ${current}; not publishing ${version}.`);
    return;
  }

  if (assets.length > 0) {
    gh(["release", "upload", tag, "--clobber", ...assets]);
  }
  const signed = existsSync(signaturePath);
  const feed = [manifestPath];
  if (signed) {
    feed.push(signaturePath);
  }
  gh(["release", "upload", tag, "--clobber", ...feed]);

  const published = releaseAssetNames(tag) ?? [];
  // A signature left from an earlier signed publish would not match this
  // manifest, and updaters would reject the feed.
  if (!signed && published.includes("manifest.sig")) {
    gh(["release", "delete-asset", tag, "manifest.sig", "--yes"]);
  }
  const keepZips = assets
    .map((asset) => basename(asset))
    .filter((name) => DEPLOY_ZIP.test(name));
  if (keepZips.length > 0) {
    for (const name of staleZipAssets(published, keepZips)) {
      gh(["release", "delete-asset", tag, name, "--yes"]);
    }
  }
  console.log(
    `${tag} now offers ${version}${current ? ` (was ${current})` : ""}.`,
  );
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main(process.argv.slice(2));
}
