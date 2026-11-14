#!/usr/bin/env node
// Team simulation (#1981). Commands:
//   sim up [--dry-run]        create/update ~/.wgw-sim/checkout and start wgw-sim on :9290
//   sim down                  stop wgw-sim
//   sim bootstrap [--date D]  reconcile the world for date D (default today)
//   sim plan [--date D] [--json] [--data DIR] [--habits all]   the night's action list from a data dir
//   sim night [--date D] [--minutes N] [--ui-only] [--api-only] [--skip-upgrade] [--no-diary] [--habits all]
//   sim replay <date> [--action N] [--minutes N] [--plan-only] [--keep]
//   sim status                last completed night; exits 1 after two days without one
//   sim report <date>         re-render the morning report from a finished run
//   sim diary <date> [--no-llm]  friction, persona diaries and (Sunday) digest again; rewrites the report
import { realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import { execFileSync } from "node:child_process";
import { createShell } from "../src/instance/sh.mjs";
import { layout } from "../src/instance/config.mjs";
import { createInstance } from "../src/instance/instance.mjs";

const argv = process.argv.slice(2);
const command = argv[0];
const flag = (name) => argv.includes(`--${name}`);
const option = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : fallback;
};
const today = () => new Date().toLocaleDateString("sv-SE");
const log = (line) => console.log(`[sim ${new Date().toLocaleTimeString("nl-NL")}] ${line}`);

function repoRoot() {
  const common = execFileSync("git", ["rev-parse", "--git-common-dir"], { cwd: dirname(realpathSync(import.meta.filename)), encoding: "utf8" }).trim();
  return dirname(realpathSync(common));
}

function liveInstance(shell) {
  const paths = layout();
  return {
    paths,
    instance: createInstance({ shell, project: "wgw-sim", checkout: paths.checkout, dataDir: paths.data, liveDataDir: paths.data, snapshotsDir: paths.snapshots, repoRoot: repoRoot(), log }),
  };
}

async function main() {
  switch (command) {
    case "up": {
      const shell = createShell({ log, dryRun: flag("dry-run") });
      const { instance } = liveInstance(shell);
      await instance.ensureDocker();
      instance.guard();
      instance.ensureWorktree();
      if (!flag("no-build")) await instance.build();
      await instance.start();
      log(`wgw-sim is up at http://127.0.0.1:9290 (commit ${shell.dryRun ? "dry-run" : instance.sha().slice(0, 10)})`);
      return;
    }
    case "down": {
      const shell = createShell({ log });
      liveInstance(shell).instance.down();
      return;
    }
    case "bootstrap": {
      const { runBootstrap } = await import("../src/bootstrap/cli.mjs");
      await runBootstrap({ date: option("date", today()), log, dryRun: flag("dry-run") });
      return;
    }
    case "plan": {
      const { printPlan } = await import("../src/night/cli.mjs");
      await printPlan({ date: option("date", today()), json: flag("json"), dataDir: option("data") ?? undefined, habits: option("habits") ?? undefined, log });
      return;
    }
    case "night": {
      const { runNight } = await import("../src/night/night.mjs");
      const result = await runNight({
        date: option("date", today()),
        minutes: Number(option("minutes", 55)),
        uiOnly: flag("ui-only"),
        apiOnly: flag("api-only"),
        skipUpgrade: flag("skip-upgrade"),
        noDiary: flag("no-diary"),
        habits: option("habits") ?? undefined,
        manual: true,
        log,
        repoRoot: repoRoot(),
      });
      process.exitCode = result.ok ? 0 : 1;
      return;
    }
    case "replay": {
      const { runReplay } = await import("../src/replay/replay.mjs");
      const result = await runReplay({ date: argv[1], action: option("action"), minutes: Number(option("minutes", 55)), planOnly: flag("plan-only"), keep: flag("keep"), log, repoRoot: repoRoot() });
      process.exitCode = result.ok ? 0 : 1;
      return;
    }
    case "status": {
      const { status } = await import("../src/schedule/status.mjs");
      const s = status({ paths: layout(), now: new Date() });
      console.log(s.text);
      process.exitCode = s.ok ? 0 : 1;
      return;
    }
    case "report": {
      const { rerenderReport } = await import("../src/report/cli.mjs");
      console.log(await rerenderReport({ date: argv[1] ?? today(), paths: layout() }));
      return;
    }
    case "diary": {
      const { writeFileSync } = await import("node:fs");
      const { afterNight } = await import("../src/night/after.mjs");
      const { rerenderReport } = await import("../src/report/cli.mjs");
      const { loadWorld } = await import("../src/world/load.mjs");
      const paths = layout();
      const date = argv[1] ?? today();
      await afterNight({ paths, world: loadWorld(), date, log, diaries: !flag("no-llm") });
      const file = join(paths.reports, `${date}.md`);
      writeFileSync(file, await rerenderReport({ date, paths }));
      log(`report: ${file}`);
      return;
    }
    default:
      console.log(readUsage());
      process.exitCode = command ? 1 : 0;
  }
}

function readUsage() {
  return execFileSync("sed", ["-n", "2,12p", join(dirname(realpathSync(import.meta.filename)), "sim.mjs")], { encoding: "utf8" }).replace(/^\/\/ ?/gm, "");
}

main().catch((error) => {
  console.error(error.stack ?? error.message);
  process.exit(1);
});
