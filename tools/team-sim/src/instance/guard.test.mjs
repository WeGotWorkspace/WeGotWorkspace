import test from "node:test";
import assert from "node:assert/strict";
import { guardProblems } from "./guard.mjs";
import { FORBIDDEN_PORTS, PROJECTS, origin } from "./config.mjs";
import { composeInvocation } from "./instance.mjs";

const home = "/Users/x/.wgw-sim";
const base = {
  project: "wgw-sim",
  checkout: `${home}/checkout`,
  composeFile: `${home}/checkout/compose.dev.yml`,
  dataDir: `${home}/data`,
  liveDataDir: `${home}/data`,
  snapshotsDir: `${home}/snapshots`,
};
const probes = (over = {}) => ({ portOwner: () => null, gitRoot: () => null, device: () => 1, ...over });

test("refuses a port taken by anything but wgw-sim or wgw-sim-replay", () => {
  const other = guardProblems({ ...base, probes: probes({ portOwner: (p) => (p === 9290 ? { other: "php pid 42" } : null) }) });
  assert.match(other.join(), /port 9290 is taken by another process/);
  const dev = guardProblems({ ...base, probes: probes({ portOwner: (p) => (p === 9290 ? { composeProject: "wgw-dev" } : null) }) });
  assert.match(dev.join(), /Compose project "wgw-dev"/);
  const replayOnLive = guardProblems({ ...base, probes: probes({ portOwner: (p) => (p === 2580 ? { composeProject: "wgw-sim-replay" } : null) }) });
  assert.match(replayOnLive.join(), /wgw-sim-replay/);
});

test("updates its own running wgw-sim on :9290", () => {
  const own = guardProblems({ ...base, probes: probes({ portOwner: () => ({ composeProject: "wgw-sim" }) }) });
  assert.deepEqual(own, []);
});

test("replay publishes different MailHog host ports than wgw-sim", () => {
  const live = composeInvocation({ project: "wgw-sim", checkout: base.checkout, dataDir: base.dataDir }).env;
  const replay = composeInvocation({ project: "wgw-sim-replay", checkout: `${home}/replay/checkout`, dataDir: `${home}/replay/data` }).env;
  assert.notEqual(live.WGW_SIM_SMTP_PORT, replay.WGW_SIM_SMTP_PORT);
  assert.notEqual(live.WGW_SIM_MAIL_API_PORT, replay.WGW_SIM_MAIL_API_PORT);
  assert.notEqual(live.WGW_DOCKER_HTTP_PORT, replay.WGW_DOCKER_HTTP_PORT);
  assert.deepEqual([live.WGW_SIM_SMTP_PORT, live.WGW_SIM_MAIL_API_PORT], ["2590", "2580"]);
  assert.deepEqual([replay.WGW_SIM_SMTP_PORT, replay.WGW_SIM_MAIL_API_PORT], ["2591", "2581"]);
});

test("APP_URL is the project origin", () => {
  assert.equal(origin("wgw-sim"), "http://127.0.0.1:9290");
  assert.equal(origin("wgw-sim-replay"), "http://127.0.0.1:9291");
});

test("refuses a data dir inside a git checkout", () => {
  const p = guardProblems({ ...base, dataDir: "/repo/apps/wegotworkspace/wgw-content", probes: probes({ gitRoot: (d) => (d.startsWith("/repo") ? "/repo" : null) }) });
  assert.match(p.join(), /inside the git checkout \/repo/);
});

test("refuses the dev and PR-test ports", () => {
  for (const port of [9080, 5173, 4173, 9090, 5190, 4190]) assert.ok(FORBIDDEN_PORTS.includes(port));
  for (const ports of Object.values(PROJECTS)) for (const port of Object.values(ports)) assert.ok(!FORBIDDEN_PORTS.includes(port));
});

test("refuses a Compose project name other than wgw-sim or wgw-sim-replay", () => {
  assert.match(guardProblems({ ...base, project: "wgw-dev", probes: probes() }).join(), /not wgw-sim or wgw-sim-replay/);
  assert.throws(() => composeInvocation({ project: "wgw-dev", checkout: base.checkout, dataDir: base.dataDir }));
});

test("refuses a compose file outside the sim worktree", () => {
  const p = guardProblems({ ...base, composeFile: "/Users/x/Sites/sabre-installer/compose.dev.yml", probes: probes() });
  assert.match(p.join(), /outside the sim worktree/);
});

test("refuses data and snapshot dirs on different volumes", () => {
  const p = guardProblems({ ...base, probes: probes({ device: (d) => (d.includes("snapshots") ? 2 : 1) }) });
  assert.match(p.join(), /different volumes/);
});

test("wgw-sim-replay refuses ~/.wgw-sim/data", () => {
  const p = guardProblems({ ...base, project: "wgw-sim-replay", checkout: `${home}/replay/checkout`, composeFile: `${home}/replay/checkout/compose.dev.yml`, probes: probes() });
  assert.match(p.join(), /may not use the live data dir/);
});
