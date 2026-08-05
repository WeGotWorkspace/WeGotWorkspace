import { access } from "node:fs/promises";
import { join } from "node:path";

import { findRepoRoot } from "./repo-root.js";
import { runPnpmCommand, runResultToJson } from "./run-command.js";
import { getVerificationContext } from "./verification-context.js";

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function looksLikeRepoRootMarker(root: string): Promise<boolean> {
  const hasPackageJson = await fileExists(join(root, "package.json"));
  const hasWorkspaceOrAgents =
    (await fileExists(join(root, "pnpm-workspace.yaml"))) ||
    (await fileExists(join(root, "AGENTS.md")));

  return hasPackageJson && hasWorkspaceOrAgents;
}

async function main(): Promise<void> {
  const originalCwd = process.cwd();
  process.chdir("/tmp");

  try {
    const root = await findRepoRoot();
    if (!(await looksLikeRepoRootMarker(root))) {
      throw new Error(`findRepoRoot from /tmp returned unexpected path: ${root}`);
    }
  } finally {
    process.chdir(originalCwd);
  }

  const context = await getVerificationContext();
  if (!context.includes("Agent policy vs enforcement")) {
    throw new Error("get_verification_context smoke check failed");
  }

  const result = await runPnpmCommand({
    args: ["--version"],
    label: "PNPM VERSION",
    timeoutMs: 30_000,
    tailLines: 5,
  });

  if (result.status !== "passed") {
    throw new Error(`pnpm --version failed: ${runResultToJson(result)}`);
  }

  if (!result.output.trim()) {
    throw new Error("run command returned empty output");
  }

  console.error("smoke-test: OK");
  console.error(runResultToJson(result));
}

main().catch((error: unknown) => {
  console.error("smoke-test: FAILED", error);
  process.exit(1);
});
