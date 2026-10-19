import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const setupScript = path.join(repoRoot, "tools/setup-docker-install.sh");
const releaseWorkflow = path.join(repoRoot, ".github/workflows/release.yml");
const sqliteDatabase = "/var/wgw/content/db.sqlite";

function mysqlEnv() {
  return [
    "COMPOSE_PROFILES=mysql",
    "WGW_WAIT_FOR_DB=1",
    "WGW_DB_HOST=db",
    "WGW_DB_DATABASE=wgw",
    "MARIADB_DATABASE=wgw",
    "WGW_HTTP_PORT=8080",
    "",
  ].join("\n");
}

/** Source the installer the way the release smoke does, then call the profile. */
function applyProfile(envPath, sqlite) {
  const flag = sqlite ? "WGW_SQLITE=1" : "WGW_SQLITE=0";
  return spawnSync(
    "sh",
    ["-c", `WGW_SETUP_LIB=1 . "$1"; ${flag}; apply_sqlite_profile "$2"`, "sh", setupScript, envPath],
    { encoding: "utf8" },
  );
}

test("apply_sqlite_profile points WGW_DB_DATABASE at the content volume", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "wgw-sqlite-profile-"));
  const envPath = path.join(dir, ".env");
  writeFileSync(envPath, mysqlEnv());

  try {
    const result = applyProfile(envPath, true);
    assert.equal(result.status, 0, result.stderr);
    const body = readFileSync(envPath, "utf8");
    assert.match(body, /^COMPOSE_PROFILES=sqlite$/m);
    assert.match(body, /^WGW_WAIT_FOR_DB=0$/m);
    assert.match(body, /^WGW_DB_HOST=$/m);
    assert.equal(body.match(/^WGW_DB_DATABASE=(.*)$/m)?.[1], sqliteDatabase);
    assert.match(body, /^MARIADB_DATABASE=wgw$/m);
    assert.match(body, /^WGW_HTTP_PORT=8080$/m);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("apply_sqlite_profile leaves the MySQL database name alone", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "wgw-mysql-profile-"));
  const envPath = path.join(dir, ".env");
  writeFileSync(envPath, mysqlEnv());

  try {
    const result = applyProfile(envPath, false);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(readFileSync(envPath, "utf8"), mysqlEnv());
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the MySQL env example keeps WGW_DB_DATABASE=wgw", () => {
  const example = readFileSync(path.join(repoRoot, "docker/install/.env.example"), "utf8");
  assert.match(example, /^WGW_DB_DATABASE=wgw$/m);
  assert.match(example, /^MARIADB_DATABASE=wgw$/m);
});

test("release smoke calls apply_sqlite_profile and still plants the volume database", () => {
  const workflow = readFileSync(releaseWorkflow, "utf8");
  assert.match(workflow, /WGW_SETUP_LIB=1/);
  assert.match(workflow, /apply_sqlite_profile "\$SMOKE_DIR\/\.env"/);
  assert.equal(workflow.includes("s/^COMPOSE_PROFILES="), false);
  assert.equal(workflow.includes("s|^WGW_DB_DATABASE="), false);
  assert.match(workflow, /touch \/data\/db\.sqlite/);
  assert.match(workflow, /compose logs migrator/);
});

test("executing setup.sh still parses commands", () => {
  const result = spawnSync("sh", [setupScript, "--help"], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /--sqlite/);
});

test("sourced setup resolves SETUP_SCRIPT_DIR from the script file", () => {
  const result = spawnSync(
    "bash",
    ["-c", 'WGW_SETUP_LIB=1 . "$1"; printf "%s\\n" "$SETUP_SCRIPT_DIR"', "bash", setupScript],
    { encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), path.dirname(setupScript));
});

/** Source the installer as a library and run a shell snippet against it. */
function runLib(snippet, env = {}) {
  return spawnSync("sh", ["-c", `WGW_SETUP_LIB=1 . "$1"; ${snippet}`, "sh", setupScript], {
    encoding: "utf8",
    env: { ...process.env, WGW_MANIFEST_URL: "", WGW_INSTALL_DIR: tmpdir(), ...env },
  });
}

function cmp(a, b) {
  return runLib(`semver_cmp "${a}" "${b}"`).status;
}

test("semver_cmp orders prereleases below their release", () => {
  const ascending = [
    "0.1.121",
    "0.1.122-beta.1",
    "0.1.122-beta.2",
    "0.1.122-beta.10",
    "0.1.122-edge.5",
    "0.1.122-edge.40",
    "0.1.122",
    "v0.2.0",
    "1.0.0",
  ];
  for (let i = 1; i < ascending.length; i++) {
    assert.equal(cmp(ascending[i - 1], ascending[i]), 2, `${ascending[i - 1]} < ${ascending[i]}`);
    assert.equal(cmp(ascending[i], ascending[i - 1]), 1, `${ascending[i]} > ${ascending[i - 1]}`);
  }
  assert.equal(cmp("v1.2.3", "1.2.3"), 0);
  assert.equal(cmp("1.0.0-beta.1", "1.0.0-beta.1"), 0);
});

test("manifest_url follows the update channel", () => {
  const base = "https://github.com/WeGotWorkspace/wegotworkspace/releases";
  assert.equal(runLib("manifest_url").stdout, `${base}/latest/download/manifest.json`);
  assert.equal(
    runLib("manifest_url", { WGW_UPDATE_CHANNEL: "beta" }).stdout,
    `${base}/download/channel-beta/manifest.json`,
  );
  assert.equal(
    runLib('WGW_CHANNEL_FLAG=edge; manifest_url', { WGW_UPDATE_CHANNEL: "beta" }).stdout,
    `${base}/download/channel-edge/manifest.json`,
  );
  assert.equal(
    runLib("manifest_url", { WGW_MANIFEST_URL: "https://updates.example/manifest.json" }).stdout,
    "https://updates.example/manifest.json",
  );
});

test("--channel rejects an unknown channel", () => {
  const result = spawnSync("sh", [setupScript, "--channel", "nightly", "check"], { encoding: "utf8" });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Unknown update channel: nightly/);
});

test("edge assets come from the rolling channel-edge release", () => {
  const base = "https://github.com/WeGotWorkspace/wegotworkspace/releases";
  assert.equal(
    runLib('WGW_VERSION=0.1.122-edge.7; download_url docker-compose.yml').stdout,
    `${base}/download/channel-edge/docker-compose.yml`,
  );
  assert.equal(
    runLib('WGW_VERSION=1.0.0-beta.1; download_url docker-compose.yml').stdout,
    `${base}/download/v1.0.0-beta.1/docker-compose.yml`,
  );
});

test("save_update_channel writes WGW_UPDATE_CHANNEL once", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "wgw-channel-"));
  const envPath = path.join(dir, ".env");
  writeFileSync(envPath, mysqlEnv());
  try {
    for (const channel of ["beta", "edge"]) {
      const result = runLib(`WGW_CHANNEL_FLAG=${channel}; save_update_channel "${envPath}"`, {
        WGW_INSTALL_DIR: dir,
      });
      assert.equal(result.status, 0, result.stderr);
    }
    const body = readFileSync(envPath, "utf8");
    assert.equal(body.match(/^WGW_UPDATE_CHANNEL=/gm)?.length, 1);
    assert.match(body, /^WGW_UPDATE_CHANNEL=edge$/m);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("release workflow never makes a prerelease Latest", () => {
  const workflow = readFileSync(releaseWorkflow, "utf8");
  assert.match(workflow, /prerelease: \$\{\{ contains\(github\.ref_name, '-'\) \}\}/);
  assert.match(workflow, /make_latest: \$\{\{ !contains\(github\.ref_name, '-'\) \}\}/);
  assert.match(workflow, /publish-release-channel\.mjs beta dist\/releases/);
});
