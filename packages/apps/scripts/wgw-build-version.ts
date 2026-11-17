import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

function releaseVersion(monorepoRoot: string, env: NodeJS.ProcessEnv): string {
  const fromEnv = env.WGW_RELEASE_VERSION?.trim();
  if (fromEnv) return fromEnv.replace(/^v/, "");
  try {
    return readFileSync(path.join(monorepoRoot, "apps/wegotworkspace/VERSION"), "utf8").trim();
  } catch {
    return "";
  }
}

function shortCommit(monorepoRoot: string, env: NodeJS.ProcessEnv): string {
  const fromEnv = env.GITHUB_SHA?.trim();
  if (fromEnv) return fromEnv.slice(0, 9);
  try {
    return execFileSync("git", ["rev-parse", "--short=9", "HEAD"], {
      cwd: monorepoRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    // A Docker build copies the tree without `.git`: the version alone names the build.
    return "";
  }
}

/**
 * Build label for Copy diagnostics (#2204): release version and commit, such as
 * `0.1.124-beta.3 (abc123def)`. Falls back to `dev` when neither is known.
 */
export function resolveWgwBuildVersion(
  monorepoRoot: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const version = releaseVersion(monorepoRoot, env);
  const commit = shortCommit(monorepoRoot, env);
  if (version && commit) return `${version} (${commit})`;
  return version || commit || "dev";
}
