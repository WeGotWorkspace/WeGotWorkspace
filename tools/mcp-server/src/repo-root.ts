import { access } from "node:fs/promises";
import { execFile } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/** Levels from tools/mcp-server/{dist|src} to monorepo root. */
const LEVELS_TO_REPO_ROOT = 3;

function deriveRootFromModuleLocation(): string {
  const currentFile = fileURLToPath(import.meta.url);
  const currentDir = dirname(currentFile);
  return resolve(currentDir, ...Array<string>(LEVELS_TO_REPO_ROOT).fill(".."));
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function looksLikeRepoRoot(path: string): Promise<boolean> {
  if (!(await fileExists(join(path, "package.json")))) {
    return false;
  }

  return (
    (await fileExists(join(path, "pnpm-workspace.yaml"))) ||
    (await fileExists(join(path, "AGENTS.md")))
  );
}

export async function findRepoRoot(): Promise<string> {
  const derivedRoot = deriveRootFromModuleLocation();

  try {
    const { stdout } = await execFileAsync("git", ["rev-parse", "--show-toplevel"], {
      encoding: "utf8",
      cwd: derivedRoot,
    });
    return stdout.trim();
  } catch {
    if (await looksLikeRepoRoot(derivedRoot)) {
      return derivedRoot;
    }

    throw new Error(`Could not resolve repository root from ${derivedRoot}`);
  }
}
