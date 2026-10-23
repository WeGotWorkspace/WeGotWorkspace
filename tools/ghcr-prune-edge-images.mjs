#!/usr/bin/env node
// Delete old edge images from ghcr.io/wegotworkspace/wegotworkspace.
//
// Every merge to main promotes an image tagged `X.Y.Z-edge.N` and moves
// `:edge` onto it. Docker installs pin WGW_IMAGE to the exact version tag,
// so an edge install can still run an older edge build for a while. This
// script keeps a grace window and deletes only versions that are:
//
//   - tagged, with every tag an edge build tag (`X.Y.Z-edge.N`), and
//   - created more than WGW_GHCR_EDGE_MAX_AGE_DAYS days ago (default 14).
//
// A version that also carries `edge`, `latest`, a release tag or any other
// tag is kept.
//
// Multi-arch images are an index plus untagged per-arch (and attestation)
// manifests, each its own package version. Deleting only the index leaves
// orphans; deleting an untagged child of a live index breaks that image.
// So an untagged version is deleted only when a deleted edge index
// references it, no kept tagged version references it, and it is older
// than the cutoff too. Children go first, then their index: if a run stops
// halfway, the index is still tagged and the next run retries it. Untagged
// versions that no deleted index references are left alone.
//
// Usage:
//   node tools/ghcr-prune-edge-images.mjs [--dry-run]
//
// Needs GH_TOKEN with packages read/delete. Deleting versions needs the
// Admin role on the package for the Actions token.

import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const EDGE_TAG = /^\d+\.\d+\.\d+-edge\.\d+$/;

const INDEX_TYPES = new Set([
  "application/vnd.oci.image.index.v1+json",
  "application/vnd.docker.distribution.manifest.list.v2+json",
]);

const MANIFEST_ACCEPT = [
  ...INDEX_TYPES,
  "application/vnd.oci.image.manifest.v1+json",
  "application/vnd.docker.distribution.manifest.v2+json",
].join(", ");

/** True for a per-build edge tag such as `0.1.122-edge.57`. */
export function isEdgeBuildTag(tag) {
  return EDGE_TAG.test(tag);
}

/**
 * True when a tagged version may be deleted: every tag is an edge build
 * tag and it was created before the cutoff. Untagged versions are never
 * prunable on their own.
 */
export function isPrunableEdgeVersion(version, cutoff) {
  return (
    version.tags.length > 0 &&
    version.tags.every(isEdgeBuildTag) &&
    Date.parse(version.created_at) < cutoff.getTime()
  );
}

/**
 * Decide what to delete.
 *
 * versions: [{ id, name (digest), created_at, tags }]
 * childrenOf: Map of tagged version digest -> child digests (recursive)
 *
 * Returns [{ index, children }] in delete order: each index after its own
 * untagged children. A child shared by several deleted indexes is listed
 * once, under the first.
 */
export function planEdgePrune(versions, childrenOf, cutoff) {
  const tagged = versions.filter((v) => v.tags.length > 0);
  const untaggedByDigest = new Map(
    versions.filter((v) => v.tags.length === 0).map((v) => [v.name, v]),
  );

  const doomed = tagged.filter((v) => isPrunableEdgeVersion(v, cutoff));
  const doomedIds = new Set(doomed.map((v) => v.id));

  const keptDigests = new Set();
  for (const version of tagged) {
    if (doomedIds.has(version.id)) continue;
    keptDigests.add(version.name);
    for (const digest of childrenOf.get(version.name) ?? []) {
      keptDigests.add(digest);
    }
  }

  const claimed = new Set();
  return doomed
    .filter((index) => !keptDigests.has(index.name))
    .map((index) => {
      const children = [];
      for (const digest of childrenOf.get(index.name) ?? []) {
        const child = untaggedByDigest.get(digest);
        if (
          !child ||
          claimed.has(digest) ||
          keptDigests.has(digest) ||
          Date.parse(child.created_at) >= cutoff.getTime()
        ) {
          continue;
        }
        claimed.add(digest);
        children.push(child);
      }
      return { index, children };
    });
}

/**
 * Every manifest digest an index references, nested indexes included.
 * fetchManifest(digest) resolves to the parsed manifest JSON.
 */
export async function collectChildDigests(digest, fetchManifest) {
  const found = [];
  const seen = new Set([digest]);
  const queue = [digest];
  while (queue.length > 0) {
    const manifest = await fetchManifest(queue.shift());
    for (const entry of manifest.manifests ?? []) {
      if (seen.has(entry.digest)) continue;
      seen.add(entry.digest);
      found.push(entry.digest);
      if (INDEX_TYPES.has(entry.mediaType)) {
        queue.push(entry.digest);
      }
    }
  }
  return found;
}

function cutoffDate(days, now = new Date()) {
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
}

function listVersions(org, pkg) {
  const out = execFileSync(
    "gh",
    [
      "api",
      "--paginate",
      `/orgs/${org}/packages/container/${pkg}/versions?per_page=100`,
      "--jq",
      ".[] | {id, name, created_at, tags: (.metadata.container.tags // [])}",
    ],
    { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  );
  return out
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => JSON.parse(line));
}

async function registryClient(image, token) {
  const scope = `repository:${image}:pull`;
  const auth = Buffer.from(`token:${token}`).toString("base64");
  const res = await fetch(
    `https://ghcr.io/token?service=ghcr.io&scope=${encodeURIComponent(scope)}`,
    { headers: { Authorization: `Basic ${auth}` } },
  );
  if (!res.ok) {
    throw new Error(`ghcr.io token request failed: ${res.status}`);
  }
  const { token: bearer } = await res.json();
  return async (digest) => {
    const manifest = await fetch(
      `https://ghcr.io/v2/${image}/manifests/${digest}`,
      {
        headers: { Authorization: `Bearer ${bearer}`, Accept: MANIFEST_ACCEPT },
      },
    );
    if (!manifest.ok) {
      throw new Error(`manifest ${digest} fetch failed: ${manifest.status}`);
    }
    return manifest.json();
  };
}

function deleteVersion(org, pkg, version, dryRun) {
  const label = version.tags.length > 0 ? version.tags.join(",") : "untagged";
  console.log(
    `${dryRun ? "would delete" : "delete"} ${version.id} ${version.name} created ${version.created_at} (${label})`,
  );
  if (dryRun) return true;
  try {
    execFileSync(
      "gh",
      [
        "api",
        "--method",
        "DELETE",
        `/orgs/${org}/packages/container/${pkg}/versions/${version.id}`,
      ],
      { stdio: ["ignore", "ignore", "inherit"] },
    );
    return true;
  } catch {
    console.log(
      `warning: could not delete ${version.id} (Actions access on this package needs the Admin role)`,
    );
    return false;
  }
}

async function main(argv) {
  const dryRun = argv.includes("--dry-run");
  const org = process.env.WGW_GHCR_ORG ?? "WeGotWorkspace";
  const pkg = process.env.WGW_GHCR_EDGE_PACKAGE ?? "wegotworkspace";
  const days = Number(process.env.WGW_GHCR_EDGE_MAX_AGE_DAYS ?? "14");
  const token = process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN;
  if (!Number.isFinite(days) || days < 1) {
    throw new Error(`WGW_GHCR_EDGE_MAX_AGE_DAYS must be >= 1, got ${days}`);
  }
  if (!token) {
    throw new Error("GH_TOKEN is required to read image manifests");
  }

  const cutoff = cutoffDate(days);
  console.log(
    `Pruning ${org}/${pkg} edge builds created before ${cutoff.toISOString()}`,
  );

  const versions = listVersions(org, pkg);
  const fetchManifest = await registryClient(
    `${org.toLowerCase()}/${pkg}`,
    token,
  );

  // A manifest that cannot be read stops the run before anything is
  // deleted: without it, the kept set is incomplete.
  const childrenOf = new Map();
  for (const version of versions.filter((v) => v.tags.length > 0)) {
    childrenOf.set(
      version.name,
      await collectChildDigests(version.name, fetchManifest),
    );
  }

  const plan = planEdgePrune(versions, childrenOf, cutoff);
  if (plan.length === 0) {
    console.log("No edge builds to prune.");
    return;
  }
  for (const { index, children } of plan) {
    const childrenGone = children
      .map((child) => deleteVersion(org, pkg, child, dryRun))
      .every(Boolean);
    if (childrenGone) {
      deleteVersion(org, pkg, index, dryRun);
    } else {
      console.log(
        `warning: kept ${index.id} (${index.tags.join(",")}) so its remaining children are not orphaned`,
      );
    }
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
