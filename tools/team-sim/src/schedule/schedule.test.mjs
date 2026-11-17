import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  LABEL,
  PMSET_LINE,
  buildPlist,
  install,
  plistPath,
  uninstall,
} from "./schedule.mjs";

const setup = () => {
  const home = mkdtempSync(join(tmpdir(), "sim-schedule-"));
  const calls = [];
  const lines = [];
  return {
    home,
    calls,
    lines,
    run: (cmd, args) => calls.push([cmd, ...args]),
    log: (l) => lines.push(l),
    paths: { home: join(home, ".wgw-sim") },
  };
};

test("the plist runs a scheduled night at 01:00 under nice and logs to one file", () => {
  const plist = buildPlist({
    node: "/usr/bin/node",
    simBin: "/r/tools/team-sim/bin/sim.mjs",
    logFile: "/h/schedule.log",
    path: "/usr/bin",
    home: "/h",
  });
  assert.match(plist, new RegExp(`<string>${LABEL}</string>`));
  for (const s of [
    "/usr/bin/nice",
    "<string>night</string>",
    "<string>--scheduled</string>",
    "/h/schedule.log",
  ])
    assert.ok(plist.includes(s), s);
  assert.match(plist, /<key>Hour<\/key>\s*<integer>1<\/integer>/);
});

test("install writes and loads the agent and prints the pmset line; dry-run writes nothing", () => {
  const dry = setup();
  install({
    node: "node",
    simBin: "sim.mjs",
    paths: dry.paths,
    home: dry.home,
    uid: 501,
    dryRun: true,
    run: dry.run,
    log: dry.log,
  });
  assert.equal(existsSync(plistPath(dry.home)), false);
  assert.equal(dry.calls.length, 0);
  assert.ok(dry.lines.some((l) => l.includes(PMSET_LINE)));

  const s = setup();
  install({
    node: "node",
    simBin: "sim.mjs",
    paths: s.paths,
    home: s.home,
    uid: 501,
    run: s.run,
    log: s.log,
  });
  assert.ok(readFileSync(plistPath(s.home), "utf8").includes("--scheduled"));
  assert.deepEqual(s.calls.at(-1), [
    "launchctl",
    "bootstrap",
    "gui/501",
    plistPath(s.home),
  ]);
  assert.ok(s.lines.some((l) => l.includes(PMSET_LINE)));
});

test("uninstall unloads and removes the agent; without one it says so", () => {
  const s = setup();
  assert.equal(
    uninstall({ home: s.home, uid: 501, run: s.run, log: s.log }).removed,
    false,
  );
  install({
    node: "node",
    simBin: "sim.mjs",
    paths: s.paths,
    home: s.home,
    uid: 501,
    run: s.run,
    log: s.log,
  });
  assert.equal(
    uninstall({ home: s.home, uid: 501, run: s.run, log: s.log }).removed,
    true,
  );
  assert.equal(existsSync(plistPath(s.home)), false);
  assert.deepEqual(s.calls.at(-1), [
    "launchctl",
    "bootout",
    `gui/501/${LABEL}`,
  ]);
});
