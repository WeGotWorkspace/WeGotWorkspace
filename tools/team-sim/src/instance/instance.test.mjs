import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { HARNESS_DIR, layout } from "./config.mjs";
import { composeInvocation } from "./instance.mjs";

const overlay = readFileSync(join(HARNESS_DIR, "compose.sim.yml"), "utf8");
const service = (name) => overlay.split(/\n  (?=\w)/).find((block) => block.startsWith(`${name}:`) || block.includes(`\n  ${name}:`)) ?? "";

test("web and scheduler mount the same data dir", () => {
  const mount = "${WGW_SIM_DATA_DIR:?}:/var/www/install/wgw-content";
  const web = overlay.slice(overlay.indexOf("  web:"), overlay.indexOf("  scheduler:"));
  const scheduler = overlay.slice(overlay.indexOf("  scheduler:"), overlay.indexOf("  mailhog:"));
  assert.ok(web.includes(mount), "web mounts the data dir");
  assert.ok(scheduler.includes(mount), "scheduler mounts the data dir");
  const env = composeInvocation({ project: "wgw-sim", checkout: "/c", dataDir: "/d" }).env;
  assert.equal(env.WGW_SIM_DATA_DIR, "/d");
  assert.equal(env.WGW_DOCKER_HTTP_PORT, "9290");
});

test("the overlay caps Apache at 5 workers without keep-alive, disables login throttle and overrides MailHog ports", () => {
  const workers = readFileSync(join(HARNESS_DIR, "docker", "apache-workers.conf"), "utf8");
  assert.match(workers, /MaxRequestWorkers 5/);
  assert.match(workers, /^KeepAlive Off$/m);
  assert.match(overlay, /WGW_DISABLE_LOGIN_THROTTLE: "1"/);
  assert.match(overlay, /mailhog:\n    ports: !override/);
  assert.match(overlay, /web:\n    ports: !override\n      - "127\.0\.0\.1:\$\{WGW_DOCKER_HTTP_PORT:\?\}:80"/);
  assert.equal(service("nope"), "");
});

// Needs the live instance (`sim up` ran). Skipped elsewhere.
const paths = layout();
const live = existsSync(join(paths.data, "db.sqlite")) && process.env.WGW_SIM_LIVE_TESTS === "1";

test("after a first and a second boot, the sqlite file the app opens is under ~/.wgw-sim/data", { skip: !live && "set WGW_SIM_LIVE_TESTS=1 after `sim up`" }, () => {
  assert.ok(paths.data.startsWith(homedir()));
  const env = readFileSync(join(paths.checkout, "packages", "api", ".env"), "utf8");
  assert.match(env, /^WGW_DB_DATABASE=\.\/wgw-content\/db\.sqlite$/m);
  assert.match(env, /^WGW_DATA_DIR=\.\/wgw-content$/m);
  assert.ok(existsSync(join(paths.data, "db.sqlite")));
  assert.ok(!existsSync(join(paths.checkout, "apps", "wegotworkspace", "wgw-content", "db.sqlite")), "no database inside the worktree");
});
