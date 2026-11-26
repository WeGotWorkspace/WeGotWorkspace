#!/usr/bin/env node
// Spike 4 scale harness: `pnpm measure` (see --help).
// Builds the Storybook statically (production React, StrictMode off), serves it, opens the
// Sheets/Scale story in headless Chromium (Playwright) once per run per configuration,
// and writes results/scale-<stamp>.{json,md} plus results/latest.{json,md}.
import { execSync, spawnSync } from "node:child_process";
import { createReadStream, existsSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const staticDir = path.join(root, "storybook-static");

function parseArgs(argv) {
  const opts = {
    runs: 3,
    sizes: [1000, 5000, 10000, 25000, 50000, 100000],
    cols: [10, 30],
    variants: ["baseline", "win-full", "win-incr"],
    build: true,
    layouts: true,
    worker: true,
    matrix: true,
    out: path.join(root, "results"),
    baselineMaxCells: 300_000,
    fullMaxCells: 1_500_000,
    stepBudgetMs: 15_000,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => argv[++i];
    if (arg === "--runs") opts.runs = Number(next());
    else if (arg === "--sizes") opts.sizes = next().split(",").map(Number);
    else if (arg === "--cols") opts.cols = next().split(",").map(Number);
    else if (arg === "--variants") opts.variants = next().split(",");
    else if (arg === "--no-build") opts.build = false;
    else if (arg === "--no-layouts") opts.layouts = false;
    else if (arg === "--no-worker") opts.worker = false;
    else if (arg === "--no-matrix") opts.matrix = false;
    else if (arg === "--out") opts.out = path.resolve(next());
    else if (arg === "--quick") {
      opts.runs = 1;
      opts.sizes = [1000, 10000];
      opts.stepBudgetMs = 5000;
    } else if (arg === "--help") {
      console.log(`pnpm measure [--runs 3] [--sizes 1000,5000,...] [--cols 10,30]
  [--variants baseline,win-full,win-incr] [--no-build] [--no-layouts] [--no-worker]
  [--no-matrix] [--quick] [--out dir]`);
      process.exit(0);
    }
  }
  return opts;
}

const opts = parseArgs(process.argv.slice(2));

function uptime() {
  try {
    return execSync("uptime", { encoding: "utf8" }).trim();
  } catch {
    return os.loadavg().map((n) => n.toFixed(2)).join(" ");
  }
}

function machine() {
  const cpus = os.cpus();
  let model = cpus[0]?.model ?? "unknown";
  try {
    model = execSync("sysctl -n machdep.cpu.brand_string", { encoding: "utf8" }).trim() || model;
  } catch {}
  let power = "";
  try {
    power = execSync("pmset -g batt | head -1", { encoding: "utf8", shell: "/bin/sh" }).trim();
  } catch {}
  return {
    cpu: model,
    cores: cpus.length,
    memGB: Math.round(os.totalmem() / 2 ** 30),
    os: `${os.platform()} ${os.release()}`,
    node: process.version,
    power,
  };
}

// ------------------------------------------------------------------ static server

const MIME = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".woff2": "font/woff2" };

function serve(dir) {
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://x");
    let file = path.join(dir, decodeURIComponent(url.pathname));
    if (!file.startsWith(dir)) return res.writeHead(403).end();
    if (existsSync(file) && statSync(file).isDirectory()) file = path.join(file, "index.html");
    if (!existsSync(file)) return res.writeHead(404).end();
    res.writeHead(200, { "content-type": MIME[path.extname(file)] ?? "application/octet-stream" });
    createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)));
}

// ------------------------------------------------------------------ stats

function quantile(sorted, q) {
  if (sorted.length === 0) return null;
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * q) - 1))];
}
function stats(values) {
  const v = values.filter((x) => typeof x === "number" && Number.isFinite(x)).sort((a, b) => a - b);
  if (v.length === 0) return null;
  const mid = Math.floor(v.length / 2);
  const median = v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
  return { n: v.length, median, p95: quantile(v, 0.95), min: v[0], max: v[v.length - 1] };
}

// ------------------------------------------------------------------ main

async function main() {
  if (opts.build || !existsSync(staticDir)) {
    console.log("building storybook (production)…");
    const result = spawnSync("pnpm", ["exec", "storybook", "build", "-o", staticDir, "--quiet", "--disable-telemetry"], {
      cwd: root,
      stdio: "inherit",
      env: { ...process.env, NODE_ENV: "production", STORYBOOK_DISABLE_TELEMETRY: "1" },
    });
    if (result.status !== 0) throw new Error("storybook build failed");
  }
  const server = await serve(staticDir);
  const port = server.address().port;
  const storyUrl = `http://127.0.0.1:${port}/iframe.html?id=sheets-scale--scale&viewMode=story`;

  const browser = await chromium.launch({
    headless: true,
    args: ["--enable-precise-memory-info", "--js-flags=--expose-gc --max-old-space-size=8192"],
  });
  const env = { machine: machine(), chromium: browser.version(), startedAt: new Date().toISOString(), uptimeStart: uptime(), options: { ...opts, out: undefined } };
  console.log(JSON.stringify(env, null, 2));

  const openPage = async () => {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await context.newPage();
    page.setDefaultTimeout(20 * 60_000);
    await page.goto(storyUrl);
    await page.waitForFunction(() => Boolean(window.__scale), null, { timeout: 60_000 });
    return { page, context };
  };

  const configs = [];
  const failed = new Set();
  if (opts.matrix) {
    for (const cols of opts.cols) {
      for (const rows of opts.sizes) {
        for (const variant of opts.variants) {
          const cells = rows * cols;
          if (variant === "baseline" && cells > opts.baselineMaxCells) continue;
          if (variant === "win-full" && cells > opts.fullMaxCells) continue;
          configs.push({ rows, cols, variant });
        }
      }
    }
  }

  const results = [];
  for (const config of configs) {
    const familyKey = `${config.cols}|${config.variant}`;
    if (failed.has(familyKey)) {
      results.push({ config, skipped: "a smaller size of this variant failed" });
      continue;
    }
    const runs = [];
    const loadBefore = uptime();
    let failure = null;
    for (let run = 0; run < opts.runs; run += 1) {
      const started = Date.now();
      let handle;
      try {
        handle = await openPage();
        const result = await handle.page.evaluate((c) => window.__scale.run(c), { ...config, stepBudgetMs: opts.stepBudgetMs });
        result.wallMs = Date.now() - started;
        runs.push(result);
        console.log(`${config.rows}x${config.cols} ${config.variant} run ${run + 1}: ${(result.wallMs / 1000).toFixed(1)} s${result.errors.length ? ` errors: ${result.errors.join("; ")}` : ""}`);
      } catch (error) {
        failure = String(error?.message ?? error).split("\n")[0];
        console.log(`${config.rows}x${config.cols} ${config.variant} run ${run + 1} FAILED: ${failure}`);
      } finally {
        await handle?.context.close().catch(() => {});
      }
      if (failure) break;
    }
    if (failure && runs.length === 0) failed.add(familyKey);
    results.push({ config, loadBefore, loadAfter: uptime(), failure, runs, summary: summarize(runs) });
    flush(env, results, null, null);
  }

  let layouts = null;
  if (opts.layouts) {
    layouts = [];
    const layoutConfigs = [
      { rows: 10000, cols: 10 },
      { rows: 10000, cols: 30 },
      { rows: 50000, cols: 10 },
      { rows: 10000, cols: 10, notation: "current" },
      { rows: 10000, cols: 30, notation: "current" },
    ];
    for (const config of layoutConfigs) {
      let handle;
      try {
        handle = await openPage();
        const rows = await handle.page.evaluate((c) => window.__scale.layouts(c), config);
        layouts.push(...rows);
        console.log(`layouts ${config.rows}x${config.cols} ${config.notation ?? "absolute"} done`);
      } catch (error) {
        layouts.push({ ...config, failure: String(error?.message ?? error).split("\n")[0] });
      } finally {
        await handle?.context.close().catch(() => {});
      }
      flush(env, results, layouts, null);
    }
  }

  let worker = null;
  if (opts.worker) {
    worker = [];
    for (const config of [
      { rows: 10000, cols: 10 },
      { rows: 50000, cols: 10 },
      { rows: 50000, cols: 30 },
    ]) {
      let handle;
      try {
        handle = await openPage();
        worker.push(await handle.page.evaluate((c) => window.__scale.worker(c), config));
        console.log(`worker ${config.rows}x${config.cols} done`);
      } catch (error) {
        worker.push({ ...config, failure: String(error?.message ?? error).split("\n")[0] });
      } finally {
        await handle?.context.close().catch(() => {});
      }
      flush(env, results, layouts, worker);
    }
  }

  env.uptimeEnd = uptime();
  env.finishedAt = new Date().toISOString();
  const files = flush(env, results, layouts, worker, true);
  await browser.close();
  server.close();
  console.log(`wrote ${files.join(", ")}`);
}

function summarize(runs) {
  if (runs.length === 0) return null;
  const out = {};
  const scalarKeys = new Set(runs.flatMap((run) => Object.keys(run.scalars)));
  for (const key of scalarKeys) out[key] = stats(runs.map((run) => run.scalars[key]));
  const sampleKeys = new Set(runs.flatMap((run) => Object.keys(run.samples)));
  for (const key of sampleKeys) out[key] = stats(runs.flatMap((run) => run.samples[key] ?? []));
  out.errors = runs.flatMap((run) => run.errors);
  return out;
}

const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);

function flush(env, results, layouts, worker, final = false) {
  mkdirSync(opts.out, { recursive: true });
  const json = JSON.stringify({ env, results, layouts, worker }, null, 1);
  const md = markdown(env, results, layouts, worker);
  const files = [path.join(opts.out, `scale-${stamp}.json`), path.join(opts.out, `scale-${stamp}.md`)];
  writeFileSync(files[0], json);
  writeFileSync(files[1], md);
  if (final) {
    writeFileSync(path.join(opts.out, "latest.json"), json);
    writeFileSync(path.join(opts.out, "latest.md"), md);
  }
  return files;
}

// ------------------------------------------------------------------ markdown

const f = (value, digits = 1) => (value === null || value === undefined ? "—" : typeof value === "number" ? value.toFixed(digits) : String(value));
const med = (s, key, digits = 1) => f(s?.[key]?.median, digits);
const mp = (s, key, digits = 1) => (s?.[key] ? `${f(s[key].median, digits)} / ${f(s[key].p95, digits)}` : "—");
const kb = (s, key) => (s?.[key] ? `${(s[key].median / 1024).toFixed(0)} KB` : "—");

function markdown(env, results, layouts, worker) {
  const lines = [];
  lines.push(`# Spike 4 scale run — ${env.startedAt}`, "");
  lines.push(`- Machine: ${env.machine.cpu}, ${env.machine.cores} cores, ${env.machine.memGB} GB, ${env.machine.os}${env.machine.power ? `, ${env.machine.power}` : ""}`);
  lines.push(`- Browser: Chromium ${env.chromium} headless (Playwright), production Storybook build, StrictMode off`);
  lines.push(`- Load at start: \`${env.uptimeStart}\``);
  if (env.uptimeEnd) lines.push(`- Load at end: \`${env.uptimeEnd}\``);
  lines.push(`- Runs per configuration: ${env.options.runs} (fresh page each). Load metrics: median over runs. Interaction metrics: samples pooled over runs, median / p95.`, "");

  lines.push("## Load and model", "");
  lines.push("| rows×cols | variant | parse | fileToDoc | Yjs v1 | Yjs v2 | applyUpdate | engine build (read/graph/eval) | evaluateAll | open→paint | heap | DOM nodes | serialize |");
  lines.push("|---|---|---|---|---|---|---|---|---|---|---|---|---|");
  for (const r of results) {
    const c = r.config;
    if (!r.summary) {
      lines.push(`| ${c.rows}×${c.cols} | ${c.variant} | ${r.failure ? `FAILED: ${r.failure}` : r.skipped ?? "—"} |||||||||||`);
      continue;
    }
    const s = r.summary;
    const build = s.engineBuildMs ? `${med(s, "engineBuildMs")} (${med(s, "engineReadMs")}/${med(s, "engineGraphMs")}/${med(s, "engineEvalMs")})` : "— (in render)";
    lines.push(
      `| ${c.rows}×${c.cols} | ${c.variant} | ${med(s, "parseMs")} | ${med(s, "fileToDocMs")} | ${kb(s, "yjsBytes")} | ${kb(s, "yjsBytesV2")} | ${med(s, "applyUpdateMs")} | ${build} | ${mp(s, "evaluateAllMs")} | ${med(s, "openToPaintMs")} | ${med(s, "heapLoadedMB")} MB | ${med(s, "domNodes", 0)} | ${mp(s, "docToFileSerializeMs")} |`,
    );
  }
  lines.push("", "All times ms. `open→paint` = applyUpdate + engine build + mount + first frame.", "");

  lines.push("## Interaction (median / p95, ms)", "");
  lines.push("| rows×cols | variant | edit typical | cells eval'd | edit worst (rate cell) | cells eval'd | insert row | delete row | paste 1,000 | scroll fps | frames >50 ms | long tasks (ms) | setCell / setCellAt |");
  lines.push("|---|---|---|---|---|---|---|---|---|---|---|---|---|");
  for (const r of results) {
    const c = r.config;
    if (!r.summary) continue;
    const s = r.summary;
    lines.push(
      `| ${c.rows}×${c.cols} | ${c.variant} | ${mp(s, "editTypicalMs")} | ${med(s, "editTypicalEvaluated", 0)} | ${mp(s, "editWorstMs")} | ${med(s, "editWorstEvaluated", 0)} | ${mp(s, "insertRowMs")} | ${mp(s, "deleteRowMs")} | ${mp(s, "paste1000Ms")} | ${med(s, "scrollFps")} | ${med(s, "scrollFramesOver50ms", 0)} | ${med(s, "scrollLongTasks", 0)} (${med(s, "scrollLongTaskMs", 0)}) | ${med(s, "mutateSetCellMs", 2)} / ${med(s, "mutateSetCellAtMs", 2)} |`,
    );
  }
  lines.push("", "Sync part of the same interactions (mutation + Yjs observers + engine; baseline evaluates during render, so its sync part is small and the cost shows in the paint numbers):", "");
  lines.push("| rows×cols | variant | edit typical | edit worst | insert row | delete row | paste 1,000 |");
  lines.push("|---|---|---|---|---|---|---|");
  for (const r of results) {
    if (!r.summary) continue;
    const s = r.summary;
    lines.push(`| ${r.config.rows}×${r.config.cols} | ${r.config.variant} | ${mp(s, "editTypicalSyncMs", 2)} | ${mp(s, "editWorstSyncMs", 2)} | ${mp(s, "insertRowSyncMs", 2)} | ${mp(s, "deleteRowSyncMs", 2)} | ${mp(s, "paste1000SyncMs", 2)} |`);
  }
  const errs = results.flatMap((r) => (r.summary?.errors ?? []).map((e) => `${r.config.rows}×${r.config.cols} ${r.config.variant}: ${e}`));
  if (errs.length) lines.push("", "Step errors:", "", ...errs.map((e) => `- ${e}`));
  lines.push("");

  if (layouts?.length) {
    lines.push("## Yjs layouts", "");
    lines.push("| rows×cols | notation | layout | build | Yjs v1 | Yjs v2 | applyUpdate | heap (doc) | bytes/edit | after edits |");
    lines.push("|---|---|---|---|---|---|---|---|---|---|");
    for (const l of layouts) {
      if (l.failure) {
        lines.push(`| ${l.rows}×${l.cols} | ${l.notation ?? "absolute"} | FAILED: ${l.failure} |||||||`);
        continue;
      }
      lines.push(
        `| ${l.rows}×${l.cols} | ${l.notation} | ${l.layout} | ${f(l.buildMs)} | ${(l.bytes / 1024).toFixed(0)} KB | ${(l.bytesV2 / 1024).toFixed(0)} KB | ${f(l.applyUpdateMs)} | ${f(l.heapDocMB)} MB | ${f(l.editBytesAvg, 0)} | ${(l.bytesAfterEdits / 1024).toFixed(0)} KB (+${l.edits}) |`,
      );
    }
    lines.push("");
  }

  if (worker?.length) {
    lines.push("## Worker (incremental engine in a Web Worker)", "");
    lines.push("| rows×cols | init wall | worker build | main receive | formula values | edit wall | edit main | edit worker | worst wall | worst main | worst worker | worst changed |");
    lines.push("|---|---|---|---|---|---|---|---|---|---|---|---|");
    for (const w of worker) {
      if (w.failure) {
        lines.push(`| ${w.rows}×${w.cols} | FAILED: ${w.failure} |||||||||||`);
        continue;
      }
      const m = (k) => {
        const s = stats(w[k] ?? []);
        return s ? `${f(s.median)} / ${f(s.p95)}` : "—";
      };
      lines.push(
        `| ${w.rows}×${w.cols} | ${f(w.initWallMs)} | ${f(w.initWorkerBuildMs)} | ${f(w.initMainReceiveMs)} | ${w.formulaValues} | ${m("editTypicalWallMs")} | ${m("editTypicalMainMs")} | ${m("editTypicalWorkerMs")} | ${m("editWorstWallMs")} | ${m("editWorstMainMs")} | ${m("editWorstWorkerMs")} | ${w.editWorstChanged} |`,
      );
    }
    lines.push("");
  }
  return lines.join("\n");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
