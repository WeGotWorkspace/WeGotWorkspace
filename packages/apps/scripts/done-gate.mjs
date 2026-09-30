#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const appsRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

/** Unit + jsdom stay on CI (`APPS_DONE_GATE_FULL=1` in apps-quality). */
const fullVitest = process.env.APPS_DONE_GATE_FULL === "1";

/**
 * Only retry Storybook when Vitest browser mode drops the page mid-run.
 * Real story / a11y failures must fail immediately.
 * @see https://github.com/WeGotWorkspace/WeGotWorkspace/issues/1037
 */
const BROWSER_CONNECTION_CLOSED = "Browser connection was closed";

/**
 * @param {string} task
 * @returns {string[]}
 */
function turbo(task) {
  return ["pnpm", "exec", "turbo", "run", task, "--filter=@wgw/apps"];
}

/** @type {Array<{ label: string, cmd: string[], env?: Record<string, string>, ciOnly?: boolean, retries?: number }>} */
const steps = [
  {
    label: "File-size ratchet",
    cmd: ["node", "../../tools/file-size-ratchet.mjs", "check", "packages/apps/src"],
  },
  { label: "Typecheck", cmd: ["pnpm", "typecheck"] },
  { label: "UI ↔ OpenAPI contract (Vitest)", cmd: turbo("test:contract") },
  { label: "Vitest (unit)", cmd: turbo("test:unit"), ciOnly: true },
  { label: "Vitest (jsdom)", cmd: turbo("test:jsdom"), ciOnly: true },
  {
    label: "Storybook Vitest smoke (vitest-ci + a11y gate)",
    cmd: turbo("test:storybook:ci"),
    env: { STORYBOOK_VITEST_SMOKE: "1", STORYBOOK_A11Y_GATE: "1" },
    // Retry only when output contains BROWSER_CONNECTION_CLOSED (see runStep).
    retries: 2,
  },
  { label: "Storybook coverage", cmd: ["pnpm", "check:storybook-coverage"] },
];

process.stdout.write(
  fullVitest
    ? "apps done gate: full (unit + jsdom)\n"
    : "apps done gate: local (unit + jsdom run in CI)\n",
);

/** @type {Array<{ label: string, ok: boolean, skipped?: boolean, detail?: string }>} */
const results = [];

/**
 * @typedef {{ status: number | null, output: string, errorCode?: string }} StepRun
 */

/**
 * Live output, no capture — used when retries are not needed.
 * @param {string[]} cmd
 * @param {Record<string, string>} extraEnv
 * @returns {StepRun}
 */
function runOnceInherit(cmd, extraEnv) {
  const result = spawnSync(cmd[0], cmd.slice(1), {
    cwd: appsRoot,
    stdio: ["ignore", "inherit", "inherit"],
    env: { ...process.env, ...extraEnv },
  });
  return {
    status: result.status,
    output: "",
    errorCode: result.error?.code ?? result.signal ?? undefined,
  };
}

/**
 * Live tee + capture for browser-drop detection (no maxBuffer limit).
 * @param {string[]} cmd
 * @param {Record<string, string>} extraEnv
 * @returns {Promise<StepRun>}
 */
function runOnceCaptured(cmd, extraEnv) {
  return new Promise((resolve) => {
    const child = spawn(cmd[0], cmd.slice(1), {
      cwd: appsRoot,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, ...extraEnv },
    });

    let output = "";
    /** @type {string | undefined} */
    let errorCode;

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (text) => {
      output += text;
      process.stdout.write(text);
    });
    child.stderr.on("data", (text) => {
      output += text;
      process.stderr.write(text);
    });
    child.on("error", (err) => {
      errorCode = /** @type {NodeJS.ErrnoException} */ (err).code;
      resolve({ status: null, output, errorCode });
    });
    child.on("close", (status, signal) => {
      resolve({ status, output, errorCode: errorCode ?? signal ?? undefined });
    });
  });
}

/**
 * @param {StepRun} result
 * @returns {string}
 */
function exitDetail(result) {
  if (result.status != null) {
    return `exit ${result.status}`;
  }
  return `exit ${result.errorCode ?? "unknown"}`;
}

/**
 * @param {string} label
 * @param {string[]} cmd
 * @param {Record<string, string>} [extraEnv]
 * @param {number} [retries]
 * @returns {Promise<boolean>}
 */
async function runStep(label, cmd, extraEnv = {}, retries = 0) {
  const line = cmd.join(" ");
  process.stdout.write(`\n${"─".repeat(72)}\n${label}\n${"─".repeat(72)}\n→ ${line}\n\n`);

  if (retries === 0) {
    const result = runOnceInherit(cmd, extraEnv);
    const ok = result.status === 0;
    results.push({
      label,
      ok,
      detail: ok ? undefined : exitDetail(result),
    });
    return ok;
  }

  let attempt = 0;
  /** @type {StepRun} */
  let result;
  while (attempt <= retries) {
    if (attempt > 0) {
      process.stdout.write(
        `\n⚠️  Retry attempt ${attempt}/${retries} (browser connection drop)\n\n`,
      );
    }

    result = await runOnceCaptured(cmd, extraEnv);

    if (result.status === 0) {
      break;
    }

    const isBrowserDrop = result.output.includes(BROWSER_CONNECTION_CLOSED);
    if (!isBrowserDrop || attempt >= retries) {
      break;
    }
    attempt++;
  }

  const ok = result.status === 0;
  if (ok && attempt > 0 && process.env.GITHUB_ACTIONS) {
    process.stdout.write(
      `::warning::Storybook Vitest passed on retry ${attempt} (browser connection drop)\n`,
    );
  }

  results.push({
    label,
    ok,
    detail: ok
      ? attempt > 0
        ? `passed on retry ${attempt}`
        : undefined
      : attempt > 0
        ? `${exitDetail(result)} after ${attempt + 1} attempts`
        : exitDetail(result),
  });
  return ok;
}

let passed = true;
for (const step of steps) {
  if (step.ciOnly && !fullVitest) {
    results.push({
      label: step.label,
      ok: true,
      skipped: true,
      detail: "CI only",
    });
    continue;
  }
  if (!(await runStep(step.label, step.cmd, step.env, step.retries ?? 0))) {
    passed = false;
  }
}

process.stdout.write(`\n${"═".repeat(72)}\n`);
process.stdout.write(passed ? "APPS DONE GATE: PASSED\n" : "APPS DONE GATE: FAILED\n");
process.stdout.write(`${"═".repeat(72)}\n`);
for (const row of results) {
  const mark = row.skipped ? "–" : row.ok ? "✓" : "✗";
  const detail = row.detail ? ` — ${row.detail}` : "";
  process.stdout.write(`  ${mark} ${row.label}${detail}\n`);
}
process.stdout.write("\n");

process.exit(passed ? 0 : 1);
