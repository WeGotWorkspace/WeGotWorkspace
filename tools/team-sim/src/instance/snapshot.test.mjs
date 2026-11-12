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
