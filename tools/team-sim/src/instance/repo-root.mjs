import { execFileSync } from "node:child_process";
import { dirname } from "node:path";

/**
 * The main checkout that owns `dir`'s repository. `--path-format=absolute`
 * matters: in the main checkout git otherwise answers with a path relative
 * to `dir` (`../../../.git`), which resolves against the caller's working
 * directory instead (launchd starts the night in `/`).
 */
export function repoRootOf(dir) {
  const common = execFileSync("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], { cwd: dir, encoding: "utf8" }).trim();
  return dirname(common);
}
