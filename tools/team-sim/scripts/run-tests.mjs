#!/usr/bin/env node
// Runs the package's node:test files. Positional args filter by path
// substring: `pnpm --dir tools/team-sim test -- planner` runs only
// src/planner/*.test.mjs. A filter that matches no file is an error.
import { readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(import.meta.url), "..", "..");
const filters = process.argv.slice(2).filter((a) => a !== "--" && !a.startsWith("-"));

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    if (name === "node_modules") return [];
    const full = join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : name.endsWith(".test.mjs") ? [full] : [];
  });
}

const all = walk(join(root, "src")).map((f) => relative(root, f)).sort();
const picked = filters.length ? all.filter((f) => filters.some((x) => f.includes(x))) : all;
for (const f of filters) {
  if (!all.some((file) => file.includes(f))) {
    console.error(`team-sim test: no test file matches "${f}"`);
    process.exit(1);
  }
}
const run = spawnSync(process.execPath, ["--test", ...picked], { cwd: root, stdio: "inherit" });
process.exit(run.status ?? 1);
