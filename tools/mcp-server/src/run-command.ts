import { spawn } from "node:child_process";

import {
  capOutput,
  DEFAULT_TAIL_LINES,
  tailOutput,
} from "./format-output.js";
import { findRepoRoot } from "./repo-root.js";

export type RunStatus = "passed" | "failed" | "timed_out";

export interface RunResult {
  exitCode: number;
  status: RunStatus;
  summary: string;
  output: string;
}

export interface RunPnpmOptions {
  args: string[];
  label: string;
  timeoutMs: number;
  tailLines?: number;
}

function formatSummary(label: string, status: RunStatus): string {
  switch (status) {
    case "passed":
      return `${label}: PASSED`;
    case "timed_out":
      return `${label}: TIMED OUT`;
    case "failed":
      return `${label}: FAILED`;
  }
}

export function runResultToJson(result: RunResult): string {
  return JSON.stringify(result, null, 2);
}

export async function runPnpmCommand(options: RunPnpmOptions): Promise<RunResult> {
  const repoRoot = await findRepoRoot();
  const tailLines = options.tailLines ?? DEFAULT_TAIL_LINES;

  return new Promise((resolve) => {
    let combined = "";
    let timedOut = false;
    let settled = false;

    const child = spawn("pnpm", options.args, {
      cwd: repoRoot,
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env,
    });

    const append = (chunk: Buffer) => {
      combined += chunk.toString("utf8");
      combined = capOutput(combined);
    };

    child.stdout?.on("data", append);
    child.stderr?.on("data", append);

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 5_000);
    }, options.timeoutMs);

    const finish = (exitCode: number) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);

      const status: RunStatus = timedOut
        ? "timed_out"
        : exitCode === 0
          ? "passed"
          : "failed";

      resolve({
        exitCode: timedOut ? -1 : exitCode,
        status,
        summary: formatSummary(options.label, status),
        output: tailOutput(combined, tailLines),
      });
    };

    child.on("error", () => finish(1));
    child.on("close", (code) => finish(code ?? 1));
  });
}
