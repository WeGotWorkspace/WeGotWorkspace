#!/usr/bin/env node
/**
 * Sequential jsdom Vitest shards. Each child is a fresh Node process so the
 * jsdom/Lit/TipTap/Yjs heap is reclaimed between batches.
 *
 * Files are grouped by `src/<pkg>/` (sorted keys, sorted files). Package `p`
 * starts at shard `p % N`; its files go to `(p + idx) % N`. That spreads
 * one-file packages instead of pinning every singleton on shard 1.
 * Heap-heavy RTL files (`use-calendar-controller*`, `use-contacts-controller*`,
 * `contacts-detail-view`, `workspace-live-app-shell`) each get a dedicated
 * process after the packed shards.
 * `JSDOM_SHARDS` (default 24) is the growth lever — do not raise the heap.
 * Empty packed shards are skipped when the file count is smaller than N.
 *
 * Child argv is `run --project jsdom --maxWorkers=1 <files…>` with no
 * standalone `--`. That token is for npm/pnpm script forwarding; Vitest may
 * treat it as a filter and run the whole suite (or nothing). Vitest 4.1.5
 * honors `--maxWorkers` (see `vitest --help`).
 *
 * Every shard runs even if an earlier one failed; the process prints a
 * done-gate-style ✓/✗ summary and exits non-zero if any shard failed.
 * `--with-unit` (used by `pnpm test`) runs unit first the same way.
 *
 *   node scripts/run-jsdom.mjs
 *   node scripts/run-jsdom.mjs --with-unit
 *   JSDOM_SHARDS=32 node scripts/run-jsdom.mjs
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
  const n = Number.parseInt(raw ?? "24", 10);
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
 * Known heap monsters: each gets its own process so they never share a shard.
 * @param {string} relFile
 * @returns {boolean}
 */
function isSoloFile(relFile) {
  return /(?:^|\/)(?:use-calendar-controller[^/]*|use-contacts-controller[^/]*|contacts-detail-view|workspace-live-app-shell)\.test\.tsx$/.test(
    relFile,
  );
}

/**
 * @param {string[]} files
 * @param {number} shardCount
 * @returns {string[][]}
 */
function assignShards(files, shardCount) {
  const solo = files.filter(isSoloFile).sort((a, b) => a.localeCompare(b));
  const rest = files.filter((file) => !isSoloFile(file));

  /** @type {Map<string, string[]>} */
  const byPkg = new Map();
  for (const file of rest) {
    const pkg = packageKey(file);
    const list = byPkg.get(pkg);
    if (list) {
      list.push(file);
    } else {
      byPkg.set(pkg, [file]);
    }
  }

  /** @type {string[][]} */
  const packed = Array.from({ length: shardCount }, () => []);
  const packages = [...byPkg.keys()].sort((a, b) => a.localeCompare(b));
  packages.forEach((pkg, packageIndex) => {
    const group = byPkg.get(pkg) ?? [];
    group.sort((a, b) => a.localeCompare(b));
    group.forEach((file, idx) => {
      packed[(packageIndex + idx) % shardCount].push(file);
    });
  });

  return [...packed.filter((shard) => shard.length > 0), ...solo.map((file) => [file])];
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

/**
 * @param {string} label
 * @param {string[]} args
 * @returns {{ label: string, ok: boolean, detail?: string }}
 */
function runVitest(label, args) {
  process.stdout.write(`\n${"─".repeat(72)}\n${label}\n${"─".repeat(72)}\n\n`);
  const result = spawnSync(vitestBin, args, {
    cwd: appsRoot,
    stdio: "inherit",
    env: process.env,
  });
  const ok = result.status === 0 && !result.signal;
  const detail = ok
    ? undefined
    : `exit ${result.status ?? "unknown"}${result.signal ? `, signal ${result.signal}` : ""}`;
  if (!ok) {
    process.stderr.write(`\n${label} failed (${detail})\n`);
  }
  return { label, ok, detail };
}

function main() {
  const listOnly =
    process.argv.includes("--list") ||
    process.argv.includes("--print") ||
    process.env.JSDOM_LIST === "1";
  const verboseList = process.argv.includes("--print");
  const withUnit = process.argv.includes("--with-unit");
  const shardCount = parseShardCount(process.env.JSDOM_SHARDS);
  const files = walkTestFiles(srcRoot);
  const shards = assignShards(files, shardCount);
  const totalShards = shards.length;

  if (listOnly) {
    for (let i = 0; i < shards.length; i += 1) {
      const shardFiles = shards[i];
      process.stdout.write(
        `jsdom shard ${i + 1}/${totalShards} (${shardFiles.length} files) ${domainMix(shardFiles)}\n`,
      );
      if (verboseList) {
        for (const file of shardFiles) {
          process.stdout.write(`  ${file}\n`);
        }
      }
    }
    return;
  }

  /** @type {Array<{ label: string, ok: boolean, detail?: string }>} */
  const results = [];

  if (withUnit) {
    results.push(runVitest("Vitest (unit)", ["run", "--project", "unit"]));
  }

  for (let i = 0; i < shards.length; i += 1) {
    const shardFiles = shards[i];
    const label = `jsdom shard ${i + 1}/${totalShards} (${shardFiles.length} files) ${domainMix(shardFiles)}`;
    results.push(runVitest(label, ["run", "--project", "jsdom", "--maxWorkers=1", ...shardFiles]));
  }

  const passed = results.every((row) => row.ok);
  process.stdout.write(`\n${"═".repeat(72)}\n`);
  process.stdout.write(passed ? "JSDOM SHARDS: PASSED\n" : "JSDOM SHARDS: FAILED\n");
  process.stdout.write(`${"═".repeat(72)}\n`);
  for (const row of results) {
    const mark = row.ok ? "✓" : "✗";
    const detail = row.detail ? ` — ${row.detail}` : "";
    process.stdout.write(`  ${mark} ${row.label}${detail}\n`);
  }
  process.stdout.write("\n");
  process.exit(passed ? 0 : 1);
}

main();
