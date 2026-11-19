import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, statSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createShell } from "./sh.mjs";
import { createInstance } from "./instance.mjs";
import { listSnapshots, pruneSnapshots, takeSnapshot } from "./snapshot.mjs";
import { guardProblems } from "./guard.mjs";

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "team-sim-snap-"));
  const data = join(root, "data");
  mkdirSync(data);
  writeFileSync(join(data, "db.sqlite"), "v1");
  const env = join(root, "env");
  writeFileSync(env, "APP_KEY=base64:abc\n");
  return { root, data, env, snapshots: join(root, "snapshots") };
}

/** Real cp/mv/rm, recorded docker and git. */
function recordingShell() {
  const real = createShell();
  const calls = [];
  return {
    calls,
    dryRun: false,
    run(cmd, args, opts = {}) {
      calls.push([cmd, ...args].join(" "));
      if (["cp", "mv", "rm"].includes(cmd)) return real.run(cmd, args, opts);
      if (cmd === "git" && args.includes("rev-parse")) return { status: 0, stdout: "sha-before\n", stderr: "" };
      return { status: 0, stdout: "", stderr: "" };
    },
    stream: async () => {},
  };
}

test("snapshot uses clonefile", () => {
  const f = fixture();
  const shell = recordingShell();
  const instance = { stopWriters: () => shell.calls.push("STOP") };
  takeSnapshot({ shell, instance, date: "2026-11-12", dataDir: f.data, snapshotsDir: f.snapshots, envFile: f.env, meta: { sha: "abc" } });
  const cp = shell.calls.find((c) => c.startsWith("cp "));
  assert.match(cp, process.platform === "darwin" ? /^cp -c -R / : /^cp --reflink=auto -R /);
  assert.equal(readFileSync(join(f.snapshots, "2026-11-12", "data", "db.sqlite"), "utf8"), "v1");
  assert.equal(statSync(join(f.snapshots, "2026-11-12", "env")).mode & 0o777, 0o600);
});

test("snapshot is taken with the stack stopped", () => {
  const f = fixture();
  const shell = recordingShell();
  const instance = { stopWriters: () => shell.calls.push("STOP") };
  takeSnapshot({ shell, instance, date: "2026-11-12", dataDir: f.data, snapshotsDir: f.snapshots, envFile: f.env, meta: {} });
  assert.ok(shell.calls.indexOf("STOP") < shell.calls.findIndex((c) => c.startsWith("cp ")));
});

test("snapshot is post-reconcile and replay does not reconcile", async () => {
  const f = fixture();
  const shell = recordingShell();
  const instance = { stopWriters: () => {} };
  writeFileSync(join(f.data, "db.sqlite"), "reconciled");
  const { meta, plan } = takeSnapshot({
    shell, instance, date: "2026-11-12", dataDir: f.data, snapshotsDir: f.snapshots, envFile: f.env, meta: { sha: "abc" },
    planFrom: (clone) => ({ hash: `h:${readFileSync(join(clone, "db.sqlite"), "utf8")}` }),
  });
  assert.equal(plan.hash, "h:reconciled", "the plan reads the clone");
  assert.equal(JSON.parse(readFileSync(join(f.snapshots, "2026-11-12", "meta.json"), "utf8")).actionListHash, meta.actionListHash);
  const replaySrc = readFileSync(new URL("../replay/replay.mjs", import.meta.url), "utf8");
  assert.ok(!/reconcile\(|runBootstrap|migrate\(/.test(replaySrc), "replay never reconciles or migrates");
});

test("failed migration restores the pre-upgrade clone and previous commit", async () => {
  const f = fixture();
  const shell = recordingShell();
  const instance = createInstance({ shell, project: "wgw-sim", checkout: join(f.root, "checkout"), dataDir: f.data, snapshotsDir: f.snapshots, repoRoot: f.root });
  const result = await instance.upgrade({
    rollbackDir: join(f.root, "rollback"),
    steps: {
      fastForward: () => {},
      build: async () => {},
      start: async () => writeFileSync(join(f.data, "db.sqlite"), "half-migrated"),
      migrate: () => { throw new Error("migration 2026_11_12 failed"); },
    },
  });
  assert.equal(result.ok, false);
  assert.equal(readFileSync(join(f.data, "db.sqlite"), "utf8"), "v1");
  assert.ok(shell.calls.some((c) => c.includes("reset --hard --quiet sha-before")));
  const stops = shell.calls.filter((c) => c.includes(" stop web scheduler"));
  assert.ok(stops.length >= 2, "writers stopped before the clone and again before the restore");
});

const isDump = (c) => c.includes(" exec -T db sh -c mariadb-dump ");
const isRestore = (c) => c.includes(" exec -T db sh -c mariadb ") && c.includes("< /wgw-content/.team-sim/db.sql");

/** An installed data dir, as the app leaves it after the first boot. */
function installedFixture() {
  const f = fixture();
  writeFileSync(join(f.data, ".installed"), "2026-11-19\n");
  const shell = recordingShell();
  const instance = createInstance({ shell, project: "wgw-sim", checkout: join(f.root, "checkout"), dataDir: f.data, snapshotsDir: f.snapshots, repoRoot: f.root, fetchImpl: async () => ({ ok: true }) });
  return { f, shell, instance };
}
const emptyDb = (shell) => {
  const run = shell.run;
  shell.run = (cmd, args, opts) => (args.join(" ").includes("information_schema.tables") ? { status: 0, stdout: "0\n", stderr: "" } : run(cmd, args, opts));
};
const withDump = (f) => {
  mkdirSync(join(f.data, ".team-sim"), { recursive: true });
  writeFileSync(join(f.data, ".team-sim", "db.sql"), "-- dump\n");
};

test("the database is dumped into the data dir with the writers stopped, before the snapshot clone", () => {
  const { f, shell, instance } = installedFixture();
  takeSnapshot({ shell, instance, date: "2026-11-19", dataDir: f.data, snapshotsDir: f.snapshots, envFile: f.env, meta: {} });
  const stop = shell.calls.findIndex((c) => c.includes(" stop web scheduler"));
  const dump = shell.calls.findIndex(isDump);
  const clone = shell.calls.findIndex((c) => c.startsWith("cp "));
  assert.ok(stop >= 0 && stop < dump && dump < clone, `stop, dump, clone in that order: ${stop}, ${dump}, ${clone}`);
  assert.ok(existsSync(join(f.data, ".team-sim")), "the dump's directory exists before the database writes into it");
});

test("the upgrade dumps before the rollback clone, and a rollback loads that dump again", async () => {
  const { f, shell, instance } = installedFixture();
  withDump(f);
  const result = await instance.upgrade({
    rollbackDir: join(f.root, "rollback"),
    steps: { fastForward: () => {}, build: async () => {}, start: async () => {}, migrate: () => { throw new Error("migration failed"); } },
  });
  assert.equal(result.ok, false);
  const dump = shell.calls.findIndex(isDump);
  const clone = shell.calls.findIndex((c) => c.startsWith("cp "));
  const back = shell.calls.findIndex((c) => c.startsWith("mv "));
  const restore = shell.calls.findIndex(isRestore);
  assert.ok(dump >= 0 && dump < clone, "dump before the rollback clone");
  assert.ok(back >= 0 && back < restore, "the data dir is put back before its dump is loaded");
  const reset = shell.calls.findIndex((c) => c.includes("reset --hard"));
  assert.ok(reset >= 0 && reset < restore, "the worktree is reset before the dump is loaded");
});

test("an upgrade on a lost volume restores the last dump before it dumps, or refuses without one", async () => {
  const steps = { fastForward: () => {}, build: async () => {}, start: async () => {}, migrate: () => ({}) };
  const a = installedFixture();
  withDump(a.f);
  emptyDb(a.shell);
  await a.instance.upgrade({ rollbackDir: join(a.f.root, "rollback"), steps });
  const restore = a.shell.calls.findIndex(isRestore);
  const dump = a.shell.calls.findIndex(isDump);
  assert.ok(restore >= 0 && restore < dump, "restore comes before the first dump");

  const b = installedFixture();
  emptyDb(b.shell);
  await assert.rejects(() => b.instance.upgrade({ rollbackDir: join(b.f.root, "rollback"), steps }), /no dump to restore/);
  assert.ok(!b.shell.calls.some(isDump), "an empty database is never dumped");
});

test("a data dir that was never installed has nothing to dump or restore", () => {
  const f = fixture();
  const shell = recordingShell();
  const instance = createInstance({ shell, project: "wgw-sim", checkout: join(f.root, "checkout"), dataDir: f.data, snapshotsDir: f.snapshots, repoRoot: f.root });
  assert.equal(instance.dumpDb(), false);
  assert.equal(instance.restoreDb(), false);
  assert.ok(!shell.calls.some((c) => c.startsWith("docker ")));
});

test("the first boot starts web alone, so web and scheduler do not both install", async () => {
  const f = fixture();
  const shell = recordingShell();
  const instance = createInstance({ shell, project: "wgw-sim", checkout: join(f.root, "checkout"), dataDir: f.data, snapshotsDir: f.snapshots, repoRoot: f.root, fetchImpl: async () => ({ ok: true }) });
  await instance.start();
  const ups = shell.calls.filter((c) => c.includes(" up -d --wait "));
  assert.match(ups[0], / web$/);
  assert.ok(!/ (web|db)$/.test(ups[1]), "then the whole project");
});

test("an installed data dir with an empty database gets its dump back, or the start is refused", async () => {
  const a = installedFixture();
  withDump(a.f);
  emptyDb(a.shell);
  await a.instance.start();
  const restore = a.shell.calls.findIndex(isRestore);
  const web = a.shell.calls.findIndex((c) => / up -d --wait --wait-timeout 300$/.test(c));
  assert.ok(restore >= 0 && restore < web, "restored before the app starts");

  const b = installedFixture();
  emptyDb(b.shell);
  await assert.rejects(() => b.instance.start(), /database is empty and there is no dump/);
  assert.ok(!b.shell.calls.some((c) => / up -d --wait --wait-timeout 300$/.test(c)), "the app is not started on an empty database");
});

test("replay loads the snapshot's dump into its own database and drops that database afterwards", () => {
  const src = readFileSync(new URL("../replay/replay.mjs", import.meta.url), "utf8");
  assert.ok(src.indexOf("instance.restoreDb()") < src.indexOf("await instance.start()"), "restore before start");
  assert.equal(src.match(/instance\.down\(\{ volumes: true \}\)/g)?.length, 2, "a clean volume before, and none left after");
  const live = readFileSync(new URL("../night/night.mjs", import.meta.url), "utf8") + readFileSync(new URL("../../bin/sim.mjs", import.meta.url), "utf8");
  assert.ok(!/volumes: true/.test(live), "the live project never drops its database volume");
});

test("refuses data and snapshot dirs on different volumes", () => {
  const p = guardProblems({ project: "wgw-sim", checkout: "/c", composeFile: "/c/compose.dev.yml", dataDir: "/a/data", snapshotsDir: "/Volumes/ext/snaps",
    probes: { portOwner: () => null, gitRoot: () => null, device: (d) => (d.startsWith("/Volumes") ? 9 : 1) } });
  assert.match(p.join(), /different volumes/);
});

test("prune keeps the newest 14 snapshots", () => {
  const f = fixture();
  for (let i = 1; i <= 16; i += 1) mkdirSync(join(f.snapshots, `2026-11-${String(i).padStart(2, "0")}`), { recursive: true });
  const shell = recordingShell();
  const dropped = pruneSnapshots(shell, f.snapshots);
  assert.deepEqual(dropped, ["2026-11-01", "2026-11-02"]);
  assert.equal(listSnapshots(f.snapshots).length, 14);
  assert.ok(!existsSync(join(f.snapshots, "2026-11-01")));
});
