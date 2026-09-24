#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const appsRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

/** Unit + jsdom stay on CI (`APPS_DONE_GATE_FULL=1` in apps-quality). */
const fullVitest = process.env.APPS_DONE_GATE_FULL === "1";

/** @type {list<{ label: string, cmd: string[], env?: Record<string, string>, ciOnly?: boolean }>} */
const steps = [
  { label: "Typecheck", cmd: ["pnpm", "typecheck"] },
  { label: "UI ↔ OpenAPI contract (Vitest)", cmd: ["pnpm", "test:contract"] },
  { label: "Vitest (unit)", cmd: ["pnpm", "test:unit"], ciOnly: true },
  { label: "Vitest (jsdom)", cmd: ["pnpm", "test:jsdom"], ciOnly: true },
  {
    label: "Storybook Vitest smoke (vitest-ci + a11y gate)",
    cmd: ["pnpm", "test:storybook:ci"],
    env: { STORYBOOK_VITEST_SMOKE: "1", STORYBOOK_A11Y_GATE: "1" },
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

function runStep(label, cmd, extraEnv = {}) {
  const line = cmd.join(" ");
  process.stdout.write(`\n${"─".repeat(72)}\n${label}\n${"─".repeat(72)}\n→ ${line}\n\n`);

  const result = spawnSync(cmd[0], cmd.slice(1), {
    cwd: appsRoot,
    stdio: ["ignore", "inherit", "inherit"],
    env: { ...process.env, ...extraEnv },
  });

  const ok = result.status === 0;
  results.push({
    label,
    ok,
    detail: ok ? undefined : `exit ${result.status ?? "unknown"}`,
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
  if (!runStep(step.label, step.cmd, step.env)) {
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
