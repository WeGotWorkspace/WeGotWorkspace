#!/usr/bin/env node
// Version of an edge build, from apps/wegotworkspace/VERSION and the run number.
//
//   VERSION 0.1.121        -> 0.1.122-edge.<run>  (next patch)
//   VERSION 1.3.0-beta.1   -> 1.3.0-edge.<run>    (1.3.0 is not out yet)
//
// The next stable release always sorts above every edge build before it:
// `release:publish patch` after a prerelease releases that same X.Y.Z.
//
// Usage: node tools/edge-version.mjs <VERSION> <run-number>

import { fileURLToPath } from "node:url";

export function edgeVersion(base, run) {
  const match = /^v?(\d+)\.(\d+)\.(\d+)(-[0-9A-Za-z.-]+)?$/.exec(
    String(base).trim(),
  );
  if (!match) {
    throw new Error(`VERSION is not semver: ${base}`);
  }
  if (!/^[1-9]\d*$/.test(String(run))) {
    throw new Error(`run number must be a positive integer: ${run}`);
  }
  const [, major, minor, patch, pre] = match;
  const nextPatch = pre ? Number(patch) : Number(patch) + 1;
  return `${major}.${minor}.${nextPatch}-edge.${run}`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    console.log(edgeVersion(process.argv[2] ?? "", process.argv[3] ?? ""));
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
