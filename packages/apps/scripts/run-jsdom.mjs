#!/usr/bin/env node
/**
 * Jsdom Vitest shards. Each child is a fresh Node process so the
 * jsdom/Lit/TipTap/Yjs heap is reclaimed when that process exits.
 *
 * Files are grouped by `src/<pkg>/` (sorted keys, sorted files). Package `p`
 * starts at shard `p % N`; its files go to `(p + idx) % N`. That spreads
 * one-file packages instead of pinning every singleton on shard 1.
 * Heap-heavy RTL files (`use-calendar-controller*`, `use-contacts-*`,
 * `contacts-detail-view`, `workspace-live-app-shell`) each get a dedicated
 * process after the packed shards.
 * `JSDOM_SHARDS` (default 24) is the growth lever — do not raise the heap.
 * Empty packed shards are skipped when the file count is smaller than N.
 *
 * In CI, packed shards share a pool and solo files share a smaller one
 * (`jsdom-concurrency.mjs`). Outside CI both stay at 1 unless
 * `JSDOM_CONCURRENCY` / `JSDOM_SOLO_CONCURRENCY` is set. Solo files never
 * share a pool with packed shards.
 *
 * Child argv is `run --project jsdom --maxWorkers=1 <files…>` with no
 * standalone `--`. That token is for npm/pnpm script forwarding; Vitest may
 * treat it as a filter and run the whole suite (or nothing). Vitest 4.1.5
 * honors `--maxWorkers` (see `vitest --help`).
 *
 * Every shard runs even if an earlier one failed; the process prints a
 * done-gate-style ✓/✗ summary and exits non-zero if any shard failed.
 * `--with-unit` (used by `pnpm test`) runs unit first, then the jsdom pools.
 *
 *   node scripts/run-jsdom.mjs
 *   node scripts/run-jsdom.mjs --with-unit
 *   JSDOM_SHARDS=32 node scripts/run-jsdom.mjs
 *   JSDOM_CONCURRENCY=3 JSDOM_SOLO_CONCURRENCY=2 node scripts/run-jsdom.mjs
 *   node scripts/run-jsdom.mjs --list
 *   JSDOM_LIST=1 node scripts/run-jsdom.mjs
 */
import { spawn } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { isCiEnv, jsdomConcurrency } from "./jsdom-concurrency.mjs";

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
  return /(?:^|\/)(?:use-calendar-controller[^/]*|use-contacts-[^/]*|contacts-detail-view|workspace-live-app-shell)\.test\.tsx$/.test(
    relFile,
  );
}

/**
 * @param {string[]} files
 * @param {number} shardCount
 * @returns {{ packed: string[][], solo: string[][] }}
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

  return {
    packed: packed.filter((shard) => shard.length > 0),
    solo: solo.map((file) => [file]),
  };
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

/** Serializes shard logs so parallel processes do not interleave mid-dump. */
let outputChain = Promise.resolve();

/**
 * @param {string} text
 * @returns {Promise<void>}
 */
function emitBlock(text) {
  const run = outputChain.then(
    () =>
      new Promise((resolve, reject) => {
        process.stdout.write(text, (err) => (err ? reject(err) : resolve()));
      }),
  );
  outputChain = run.catch(() => {});
  return run;
}

/**
 * @param {string} label
 * @param {string[]} args
 * @returns {Promise<{ label: string, ok: boolean, detail?: string }>}
 */
function runVitest(label, args) {
  return new Promise((resolve) => {
    let settled = false;
    /** @type {Buffer[]} */
    const chunks = [];
    const child = spawn(vitestBin, args, {
      cwd: appsRoot,
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env,
    });

    child.stdout?.on("data", (buf) => chunks.push(buf));
    child.stderr?.on("data", (buf) => chunks.push(buf));

    /**
     * @param {{ label: string, ok: boolean, detail?: string }} result
     */
    const finish = (result) => {
      if (settled) {
        return;
      }
      settled = true;
      const body = Buffer.concat(chunks).toString("utf8");
      const banner = `\n${"─".repeat(72)}\n${label}\n${"─".repeat(72)}\n\n`;
      const text =
        body.length === 0 ? banner : `${banner}${body.endsWith("\n") ? body : `${body}\n`}`;
      emitBlock(text).then(
        () => resolve(result),
        (error) =>
          resolve({
            label,
            ok: false,
            detail: error instanceof Error ? error.message : String(error),
          }),
      );
    };

    child.on("error", (error) => {
      finish({ label, ok: false, detail: error.message });
    });

    child.on("close", (status, signal) => {
      const ok = status === 0 && !signal;
      const detail = ok
        ? undefined
        : `exit ${status ?? "unknown"}${signal ? `, signal ${signal}` : ""}`;
      finish({ label, ok, detail });
    });
  });
}

/**
 * @param {Array<{ label: string, args: string[] }>} entries
 * @param {number} concurrency
 * @returns {Promise<Array<{ label: string, ok: boolean, detail?: string }>>}
 */
async function runPool(entries, concurrency) {
  /** @type {Array<{ label: string, ok: boolean, detail?: string }>} */
  const results = new Array(entries.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(concurrency, entries.length) }, async () => {
    while (cursor < entries.length) {
      const index = cursor;
      cursor += 1;
      const entry = entries[index];
      process.stdout.write(`→ ${entry.label}\n`);
      results[index] = await runVitest(entry.label, entry.args);
    }
  });
  await Promise.all(workers);
  return results;
}

/**
 * @param {string[][]} shards
 * @param {number} offset
 * @param {number} totalShards
 * @returns {Array<{ label: string, args: string[] }>}
 */
/**
 * Per-shard coverage argv. `blob` is a Vitest test reporter. Each child gets
 * its own reports directory because v8 coverage clears `reportsDirectory/.tmp`
 * on start (`clean: true`).
 *
 * @param {string} shardId
 * @returns {string[]}
 */
export function coverageVitestArgs(shardId) {
  return [
    "--coverage",
    "--reporter=blob",
    `--outputFile=.vitest-reports/blob-${shardId}.json`,
    `--coverage.reportsDirectory=coverage/shard-${shardId}`,
  ];
}

/**
 * @param {string[][]} shards
 * @param {number} offset
 * @param {number} totalShards
 * @param {boolean} coverage
 * @returns {Array<{ label: string, args: string[], shardId: string }>}
 */
function shardEntries(shards, offset, totalShards, coverage) {
  return shards.map((shardFiles, index) => {
    const shardNumber = offset + index + 1;
    const shardId = `jsdom-${shardNumber}`;
    const label = `jsdom shard ${shardNumber}/${totalShards} (${shardFiles.length} files) ${domainMix(shardFiles)}`;
    const args = ["run", "--project", "jsdom", "--maxWorkers=1"];
    if (coverage) {
      args.push(...coverageVitestArgs(shardId));
    }
    args.push(...shardFiles);
    return { label, args, shardId };
  });
}

async function main() {
  const listOnly =
    process.argv.includes("--list") ||
    process.argv.includes("--print") ||
    process.env.JSDOM_LIST === "1";
  const verboseList = process.argv.includes("--print");
  const withUnit = process.argv.includes("--with-unit");
  const coverage = process.argv.includes("--coverage");
  const shardCount = parseShardCount(process.env.JSDOM_SHARDS);
  const files = walkTestFiles(srcRoot);
  const { packed, solo } = assignShards(files, shardCount);
  const shards = [...packed, ...solo];
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

  const limits = jsdomConcurrency({
    ci: isCiEnv(process.env.CI),
    cpus: os.cpus().length,
    totalMemBytes: os.totalmem(),
    packedOverride: process.env.JSDOM_CONCURRENCY,
    soloOverride: process.env.JSDOM_SOLO_CONCURRENCY,
  });
  process.stdout.write(
    `jsdom concurrency: packed ×${limits.packed}, solo ×${limits.solo} (${isCiEnv(process.env.CI) ? "CI" : "local"})\n`,
  );

  /** @type {Array<{ label: string, ok: boolean, detail?: string }>} */
  const results = [];

  if (withUnit) {
    results.push(await runVitest("Vitest (unit)", ["run", "--project", "unit"]));
  }

  const packedEntries = shardEntries(packed, 0, totalShards, coverage);
  const soloEntries = shardEntries(solo, packed.length, totalShards, coverage);
  results.push(...(await runPool(packedEntries, limits.packed)));
  results.push(...(await runPool(soloEntries, limits.solo)));

  let passed = results.every((row) => row.ok);
  if (coverage && passed) {
    const missing = [...packedEntries, ...soloEntries].filter((entry) => {
      const blob = path.join(appsRoot, `.vitest-reports/blob-${entry.shardId}.json`);
      return !existsSync(blob);
    });
    if (missing.length > 0) {
      process.stderr.write(
        `coverage blobs missing:\n${missing.map((entry) => `  blob-${entry.shardId}.json`).join("\n")}\n`,
      );
      passed = false;
    }
  }
  const lines = [
    `\n${"═".repeat(72)}\n`,
    passed ? "JSDOM SHARDS: PASSED\n" : "JSDOM SHARDS: FAILED\n",
    `${"═".repeat(72)}\n`,
  ];
  for (const row of results) {
    const mark = row.ok ? "✓" : "✗";
    const detail = row.detail ? ` — ${row.detail}` : "";
    lines.push(`  ${mark} ${row.label}${detail}\n`);
  }
  lines.push("\n");
  await emitBlock(lines.join(""));
  process.exit(passed ? 0 : 1);
}

const invokedDirectly =
  process.argv[1] !== undefined && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);

if (invokedDirectly) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  });
}
