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
