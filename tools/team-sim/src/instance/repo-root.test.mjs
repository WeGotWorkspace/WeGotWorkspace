import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { repoRootOf } from "./repo-root.mjs";

const git = (cwd, ...args) => execFileSync("git", args, { cwd, encoding: "utf8" });

test("the repo root is found from a subdirectory of the main checkout and of a worktree, whatever the working directory", () => {
  const tmp = realpathSync(mkdtempSync(join(tmpdir(), "sim-root-")));
  const before = process.cwd();
  try {
    const main = join(tmp, "main");
    mkdirSync(join(main, "tools", "team-sim", "bin"), { recursive: true });
    git(main, "init", "--quiet");
    git(main, "-c", "user.name=t", "-c", "user.email=t@example.org", "commit", "--allow-empty", "--quiet", "-m", "init");
    const worktree = join(tmp, "wt");
    git(main, "worktree", "add", "--detach", "--quiet", worktree);
    mkdirSync(join(worktree, "tools", "team-sim", "bin"), { recursive: true });
    for (const cwd of [main, "/"]) {
      process.chdir(cwd);
      assert.equal(repoRootOf(join(main, "tools", "team-sim", "bin")), main);
      assert.equal(repoRootOf(join(worktree, "tools", "team-sim", "bin")), main);
    }
  } finally {
    process.chdir(before);
    rmSync(tmp, { recursive: true, force: true });
  }
});
