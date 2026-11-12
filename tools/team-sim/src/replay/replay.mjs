import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { executeApi, recordResult } from "../actors/api/index.mjs";
import { createRequestLog } from "../client/http.mjs";
import { createSessions } from "../client/session.mjs";
import { HARNESS_DIR, layout, origin as originOf } from "../instance/config.mjs";
import { createInstance } from "../instance/instance.mjs";
import { createShell } from "../instance/sh.mjs";
import { cloneDir, listSnapshots, readMeta, removeDir } from "../instance/snapshot.mjs";
import { runActions } from "../night/engine.mjs";
import { openRegistry } from "../state/registry.mjs";
import { loadWorld } from "../world/load.mjs";

const PROJECT = "wgw-sim-replay";

/**
 * `sim replay <date>`: the night again on that night's code and keys. The
 * snapshot is cloned into a scratch data dir and served by a second Compose
 * project from a scratch worktree at the night's commit. Nothing is migrated
 * or written to the world first: the snapshot already holds the state the
 * night's plan was computed from, and the plan computed now must hash the
 * same. With `--action N` it plays the actions up to N; with `--plan-only` it
 * stops after the hash check (no build, no stack).
 */
export async function runReplay({ date, action, minutes = 55, planOnly = false, keep = false, log = console.log, repoRoot }) {
  const paths = layout();
  const kept = listSnapshots(paths.snapshots);
  const meta = date ? readMeta(paths.snapshots, date) : null;
  if (!meta) {
    log(`No snapshot for ${date ?? "(no date)"}. Replay only works inside the snapshot window: ${kept.length ? `${kept[0]} … ${kept.at(-1)} (${kept.length} nights)` : "no snapshots yet"}.`);
    return { ok: false };
  }
  const scratch = join(paths.replay, date);
  const shell = createShell({ log: () => {} });
  const dataDir = join(scratch, "data");
  removeDir(shell, dataDir);
  cloneDir(shell, join(paths.snapshots, date, "data"), dataDir);

  // 1. The plan from the clone, by the harness at the night's harness commit.
  if (meta.harnessDirty) log(`the night ran an uncommitted harness at ${String(meta.harnessSha).slice(0, 10)}; planning with this checkout's harness instead`);
  const harness = meta.harnessDirty ? currentRoot() : harnessAt(meta.harnessSha, scratch, repoRoot, shell);
  const plan = JSON.parse(execFileSync("node", [join(harness, "tools", "team-sim", "bin", "sim.mjs"), "plan", "--date", date, "--json", "--data", dataDir], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }));
  const same = plan.hash === meta.actionListHash;
  log(`action list ${plan.hash.slice(0, 12)} ${same ? "matches" : `DIFFERS from ${String(meta.actionListHash).slice(0, 12)}`} the night's (${plan.actions.length} actions)`);
  if (!same || planOnly) {
    if (!keep) cleanup(shell, scratch, repoRoot);
    return { ok: same, plan };
  }

  // 2. The stack at the night's commit, with the night's keys and the replay origin.
  const checkout = join(scratch, "checkout");
  const instance = createInstance({ shell: createShell({ log: () => {} }), project: PROJECT, checkout, dataDir, liveDataDir: paths.data, snapshotsDir: paths.snapshots, repoRoot, log });
  await instance.ensureDocker();
  instance.guard();
  instance.ensureWorktree(meta.sha);
  const env = join(checkout, "packages", "api", ".env");
  mkdirSync(join(checkout, "packages", "api"), { recursive: true });
  copyFileSync(join(paths.snapshots, date, "env"), env);
  writeFileSync(env, readFileSync(env, "utf8").replace(/^APP_URL=.*$/m, `APP_URL=${originOf(PROJECT)}`));
  await instance.build();
  await instance.start();

  // 3. The actions up to N, in real time on the same squeeze as the night.
  const runDir = join(scratch, "run");
  const origin = originOf(PROJECT);
  const requestLog = createRequestLog(join(runDir, "requests.jsonl"));
  const client = createSessions({ origin, requestLog });
  const registry = openRegistry(dataDir);
  const ctx = { world: loadWorld(), client, origin, registry, date, expectNotify() {}, expectMail() {}, guestClient: () => client("guest", "guest") };
  const upTo = action ? Number(action) : Infinity;
  const outcomes = await runActions({
    plan,
    windowMs: minutes * 60000,
    deadline: Date.now() + (minutes + 5) * 60000,
    outcomesFile: join(runDir, "outcomes.jsonl"),
    filter: (a) => a.n <= upTo,
    execute: async (a) => {
      if (a.kind === "gap") return { note: "gap moment" };
      const result = await executeApi(a.layer === "ui" ? { ...a, layer: "api" } : a, ctx);
      recordResult(registry, a, result, date);
      return result;
    },
  });
  const target = Number.isFinite(upTo) ? outcomes.find((o) => o.n === upTo) : null;
  if (target) log(`#${upTo} ${target.persona} ${target.kind}: ${target.status}${target.error ? ` — ${target.error}` : ""}`);
  if (!keep) {
    instance.down();
    cleanup(shell, scratch, repoRoot);
  }
  return { ok: true, plan, outcomes, target };
}

/** The harness source at the night's harness commit: this checkout when it matches, else a scratch worktree. */
const currentRoot = () => execFileSync("git", ["-C", HARNESS_DIR, "rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();

function harnessAt(sha, scratch, repoRoot, shell) {
  const head = execFileSync("git", ["-C", HARNESS_DIR, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  const root = currentRoot();
  if (!sha || sha === head) return root;
  const dir = join(scratch, "harness");
  if (!existsSync(join(dir, ".git"))) shell.run("git", ["-C", repoRoot, "worktree", "add", "--detach", dir, sha]);
  return dir;
}

function cleanup(shell, scratch, repoRoot) {
  removeDir(shell, scratch);
  shell.run("git", ["-C", repoRoot, "worktree", "prune"], { allowFail: true });
}
