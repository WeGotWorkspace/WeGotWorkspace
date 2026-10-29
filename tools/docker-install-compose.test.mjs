import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const installCompose = path.join(repoRoot, "docker/install/docker-compose.yml");
const releaseCompose = path.join(repoRoot, "docker/install/docker-compose.release.yml");
const probePassword = "probe-secret-value";

const probeEnv = [
  "COMPOSE_PROFILES=sqlite",
  "WGW_WAIT_FOR_DB=0",
  "WGW_INSTALL_HEADLESS=1",
  "WGW_INSTALL_BASE_URI=/",
  "WGW_INSTALL_ADMIN_USERNAME=admin",
  "WGW_INSTALL_ADMIN_EMAIL=admin@example.com",
  `WGW_INSTALL_ADMIN_PASSWORD=${probePassword}`,
  "",
].join("\n");

/** Only what docker needs; no WGW_* or COMPOSE_* from the caller's shell. */
function dockerEnv() {
  const keep = ["PATH", "HOME", "DOCKER_HOST", "DOCKER_CONFIG", "DOCKER_CONTEXT"];
  return Object.fromEntries(keep.filter((k) => process.env[k]).map((k) => [k, process.env[k]]));
}

const composeAvailable =
  spawnSync("docker", ["compose", "version"], { env: dockerEnv(), encoding: "utf8" }).status === 0;
// CI must run these checks; a local machine without Docker skips them.
const skip = !composeAvailable && !process.env.CI ? "docker compose is not available" : false;

/** Resolved services of a compose file, as `docker compose config` sees them. */
function composeServices(file) {
  const dir = mkdtempSync(path.join(tmpdir(), "wgw-compose-env-"));
  const envFile = path.join(dir, "probe.env");
  writeFileSync(envFile, probeEnv);
  try {
    const result = spawnSync(
      "docker",
      ["compose", "-f", file, "--env-file", envFile, "config", "--format", "json"],
      { env: dockerEnv(), encoding: "utf8" },
    );
    assert.equal(result.status, 0, result.stderr);
    return JSON.parse(result.stdout).services;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function servicesWith(services, key) {
  return Object.keys(services)
    .filter((name) => Object.hasOwn(services[name].environment ?? {}, key))
    .sort();
}

test("install stack passes the admin password to the migrator only", { skip }, () => {
  const services = composeServices(installCompose);
  assert.deepEqual(servicesWith(services, "WGW_INSTALL_ADMIN_PASSWORD"), ["migrator"]);
  assert.equal(services.migrator.environment.WGW_INSTALL_ADMIN_PASSWORD, probePassword);
});

test("install stack keeps the non-secret install vars on web and scheduler", { skip }, () => {
  const services = composeServices(installCompose);
  const expected = {
    WGW_INSTALL_HEADLESS: "1",
    WGW_INSTALL_BASE_URI: "/",
    WGW_INSTALL_ADMIN_USERNAME: "admin",
    WGW_INSTALL_ADMIN_EMAIL: "admin@example.com",
  };
  for (const name of ["migrator", "web", "scheduler"]) {
    for (const [key, value] of Object.entries(expected)) {
      assert.equal(services[name].environment[key], value, `${name} ${key}`);
    }
  }
});

test("no running install service gets the probe password under any key", { skip }, () => {
  const services = composeServices(installCompose);
  for (const name of ["web", "scheduler"]) {
    const leaked = Object.entries(services[name].environment ?? {})
      .filter(([, value]) => value === probePassword)
      .map(([key]) => key);
    assert.deepEqual(leaked, [], `${name} receives the admin password`);
  }
});

test("release stack does not pass the admin password to any service", { skip }, () => {
  const services = composeServices(releaseCompose);
  assert.deepEqual(servicesWith(services, "WGW_INSTALL_ADMIN_PASSWORD"), []);
});

const heartbeatFile = "/tmp/wgw-scheduler-heartbeat";

for (const [label, file] of [
  ["install", installCompose],
  ["release", releaseCompose],
]) {
  test(`${label} stack gives the scheduler its own health check`, { skip }, () => {
    const { scheduler } = composeServices(file);
    const check = (scheduler.healthcheck?.test ?? []).join(" ");
    // Without its own check the scheduler inherits the image HEALTHCHECK,
    // which curls Apache on port 80. Nothing listens there in this container.
    assert.match(check, /\S/, "scheduler has no healthcheck");
    assert.notEqual(scheduler.healthcheck.disable, true);
    assert.doesNotMatch(check, /curl|127\.0\.0\.1|api\/v1\/health/);
    assert.ok(check.includes(heartbeatFile), `healthcheck does not read ${heartbeatFile}`);
  });

  test(`${label} stack touches the heartbeat only after schedule:run succeeds`, { skip }, () => {
    const { scheduler } = composeServices(file);
    const loop = (scheduler.command ?? []).join(" ");
    assert.match(loop, new RegExp(`schedule:run[^;]*&& touch ${heartbeatFile};`));
  });

  test(`${label} stack: each long-running service with its own entrypoint has a health check`, { skip }, () => {
    const services = composeServices(file);
    const missing = Object.keys(services)
      .filter((name) => services[name].entrypoint && services[name].restart !== "no")
      .filter((name) => !services[name].healthcheck?.test?.length)
      .sort();
    assert.deepEqual(missing, []);
  });
}
