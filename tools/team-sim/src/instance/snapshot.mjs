import { chmodSync, copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export const KEEP_SNAPSHOTS = 14;

/**
 * Copy-on-write clone of a directory tree. macOS: APFS clonefile (`cp -c`).
 * This is the one Mac-specific copy step; another host swaps it for
 * `cp --reflink=auto` or a plain copy.
 */
export function cloneDir(shell, src, dst) {
  mkdirSync(dirname(dst), { recursive: true });
  if (process.platform === "darwin") return shell.run("cp", ["-c", "-R", src, dst]);
  return shell.run("cp", ["--reflink=auto", "-R", src, dst]);
}

export function removeDir(shell, dir) {
  if (existsSync(dir) || shell.dryRun) shell.run("rm", ["-rf", dir]);
}

/**
 * The night's snapshot: taken with web and scheduler stopped, after
 * migrations and reconcile, before actions. Holds the data dir, a mode-600
 * copy of the instance's .env (APP_KEY seals share links, refresh tokens and
 * the collab key) and meta.json. `planFrom(dataClone)` computes the action
 * list from the clone, so the plan reads exactly what replay will read.
 */
export function takeSnapshot({ shell, instance, date, dataDir, snapshotsDir, envFile, meta, planFrom }) {
  const dir = join(snapshotsDir, date);
  instance.stopWriters();
  removeDir(shell, dir);
  cloneDir(shell, dataDir, join(dir, "data"));
  if (!shell.dryRun) {
    copyFileSync(envFile, join(dir, "env"));
    chmodSync(join(dir, "env"), 0o600);
  }
  const plan = planFrom ? planFrom(join(dir, "data")) : null;
  const full = { ...meta, date, actionListHash: plan?.hash ?? null, takenAt: new Date().toISOString() };
  if (!shell.dryRun) writeFileSync(join(dir, "meta.json"), `${JSON.stringify(full, null, 2)}\n`);
  return { dir, meta: full, plan };
}

export function listSnapshots(snapshotsDir) {
  if (!existsSync(snapshotsDir)) return [];
  return readdirSync(snapshotsDir).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort();
}

export function pruneSnapshots(shell, snapshotsDir, keep = KEEP_SNAPSHOTS) {
  const all = listSnapshots(snapshotsDir);
  const drop = all.slice(0, Math.max(0, all.length - keep));
  for (const d of drop) removeDir(shell, join(snapshotsDir, d));
  return drop;
}

export function readMeta(snapshotsDir, date) {
  const file = join(snapshotsDir, date, "meta.json");
  if (!existsSync(file)) return null;
  return JSON.parse(readFileSync(file, "utf8"));
}
