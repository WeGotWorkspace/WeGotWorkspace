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

test("the database is MariaDB in a named volume with no host port, and web and scheduler wait for it", () => {
  const db = overlay.slice(overlay.indexOf("\n  db:\n"), overlay.indexOf("\n  mailhog:\n"));
  assert.match(db, /image: mariadb:11/);
  assert.match(db, /- db-data:\/var\/lib\/mysql/);
  assert.ok(!/ports:/.test(db), "the database has no host port");
  assert.match(overlay, /\nvolumes:\n  db-data:\n/);
  for (const name of ["web", "scheduler"]) {
    const block = overlay.slice(overlay.indexOf(`  ${name}:`), overlay.indexOf(name === "web" ? "\n  scheduler:\n" : "\n  db:\n"));
    assert.match(block, /WGW_INSTALL_DB_DRIVER: mysql/, `${name} installs into MariaDB`);
    assert.match(block, /depends_on:\n      db:\n        condition: service_healthy/, `${name} waits for the database`);
  }
  const env = composeInvocation({ project: "wgw-sim", checkout: "/c", dataDir: "/d" }).env;
  assert.equal(env.WGW_SIM_DB_NAME, "wgw");
  assert.ok(env.WGW_SIM_DB_PASSWORD && env.WGW_SIM_DB_ROOT_PASSWORD);
});

// Needs the live instance (`sim up` ran). Skipped elsewhere.
const paths = layout();
const live = existsSync(join(paths.data, ".installed")) && process.env.WGW_SIM_LIVE_TESTS === "1";

test("after a first and a second boot, the app runs on MariaDB and keeps its files under ~/.wgw-sim/data", { skip: !live && "set WGW_SIM_LIVE_TESTS=1 after `sim up`" }, () => {
  assert.ok(paths.data.startsWith(homedir()));
  const env = readFileSync(join(paths.checkout, "packages", "api", ".env"), "utf8");
  assert.match(env, /^WGW_DB_CONNECTION=mysql$/m);
  assert.match(env, /^WGW_DB_HOST=db$/m);
  assert.match(env, /^WGW_DATA_DIR=\.\/wgw-content$/m);
  assert.ok(!existsSync(join(paths.data, "db.sqlite")), "no SQLite file in the data dir");
  assert.ok(existsSync(join(paths.data, "keys")), "keys live in the mounted data dir");
  assert.ok(!existsSync(join(paths.checkout, "apps", "wegotworkspace", "wgw-content", ".installed")), "no install inside the worktree");
});
