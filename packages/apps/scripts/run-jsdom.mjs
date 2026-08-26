#!/usr/bin/env node
/**
 * Sequential jsdom Vitest shards. Each child is a fresh Node process so the
 * jsdom/Lit/TipTap/Yjs heap is reclaimed between batches.
 *
 * Files are grouped by `src/<pkg>/` (sorted keys, sorted files). Package `p`
 * starts at shard `p % N`; its files go to `(p + idx) % N`. That spreads
 * one-file packages instead of pinning every singleton on shard 1.
 * `JSDOM_SHARDS` (default 16) is the growth lever — do not raise the heap.
 * Empty shards are skipped when the file count is smaller than N.
 *
 * Child argv is `run --project jsdom --maxWorkers=1 <files…>` with no
 * standalone `--`. That token is for npm/pnpm script forwarding; Vitest may
 * treat it as a filter and run the whole suite (or nothing).
 *
 *   node scripts/run-jsdom.mjs
 *   JSDOM_SHARDS=24 node scripts/run-jsdom.mjs
 *   node scripts/run-jsdom.mjs --list
 *   JSDOM_LIST=1 node scripts/run-jsdom.mjs
 */
import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const appsRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const srcRoot = path.join(appsRoot, "src");
const vitestBin = path.join(appsRoot, "node_modules", ".bin", "vitest");

/**
 * @param {string | undefined} raw
 * @returns {number}
 */
function parseShardCount(raw) {
  const n = Number.parseInt(raw ?? "16", 10);
  if (!Number.isInteger(n) || n < 1) {
    throw new Error(`JSDOM_SHARDS must be a positive integer (got ${JSON.stringify(raw)})`);
  }
  return n;
}

/**
 * @param {string} dir
 * @param {string[]} results
 * @returns {string[]}
 */
function walkTestFiles(dir, results = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkTestFiles(full, results);
      continue;
    }
    if (entry.isFile() && entry.name.endsWith(".test.tsx")) {
      results.push(path.relative(appsRoot, full));
    }
  }
  return results;
}

/**
 * @param {string} relFile
 * @returns {string}
 */
function packageKey(relFile) {
  const parts = relFile.split(path.sep);
  return parts[0] === "src" && parts[1] ? parts[1] : "unknown";
}

/**
 * @param {string[]} files
 * @param {number} shardCount
 * @returns {string[][]}
 */
function assignShards(files, shardCount) {
  /** @type {Map<string, string[]>} */
  const byPkg = new Map();
  for (const file of files) {
    const pkg = packageKey(file);
    const list = byPkg.get(pkg);
    if (list) {
      list.push(file);
    } else {
      byPkg.set(pkg, [file]);
    }
  }

  /** @type {string[][]} */
  const shards = Array.from({ length: shardCount }, () => []);
  const packages = [...byPkg.keys()].sort((a, b) => a.localeCompare(b));
  packages.forEach((pkg, packageIndex) => {
    const group = byPkg.get(pkg) ?? [];
    group.sort((a, b) => a.localeCompare(b));
    group.forEach((file, idx) => {
      shards[(packageIndex + idx) % shardCount].push(file);
    });
  });
  return shards;
}

/**
 * @param {string[]} files
 * @returns {string}
 */
function domainMix(files) {
  /** @type {Map<string, number>} */
  const counts = new Map();
  for (const file of files) {
    const pkg = packageKey(file);
    counts.set(pkg, (counts.get(pkg) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([pkg, n]) => `${pkg}:${n}`)
    .join(" ");
}

function main() {
  const listOnly =
    process.argv.includes("--list") ||
    process.argv.includes("--print") ||
    process.env.JSDOM_LIST === "1";
  const verboseList = process.argv.includes("--print");
  const shardCount = parseShardCount(process.env.JSDOM_SHARDS);
  const files = walkTestFiles(srcRoot);
  const shards = assignShards(files, shardCount);

  if (listOnly) {
    for (let i = 0; i < shards.length; i += 1) {
      const shardFiles = shards[i];
      if (shardFiles.length === 0) {
        continue;
      }
      process.stdout.write(
        `jsdom shard ${i + 1}/${shardCount} (${shardFiles.length} files) ${domainMix(shardFiles)}\n`,
      );
      if (verboseList) {
        for (const file of shardFiles) {
          process.stdout.write(`  ${file}\n`);
        }
      }
    }
    return;
  }

  for (let i = 0; i < shards.length; i += 1) {
    const shardFiles = shards[i];
    if (shardFiles.length === 0) {
      continue;
    }

    const label = `jsdom shard ${i + 1}/${shardCount} (${shardFiles.length} files) ${domainMix(shardFiles)}`;
    process.stdout.write(`\n${"─".repeat(72)}\n${label}\n${"─".repeat(72)}\n\n`);

    const result = spawnSync(
      vitestBin,
      ["run", "--project", "jsdom", "--maxWorkers=1", ...shardFiles],
      {
        cwd: appsRoot,
        stdio: "inherit",
        env: process.env,
      },
    );

    if (result.status !== 0) {
      process.stderr.write(
        `\n${label} failed (exit ${result.status ?? "unknown"}${result.signal ? `, signal ${result.signal}` : ""})\n`,
      );
      process.exit(result.status ?? 1);
    }
  }
}

main();
