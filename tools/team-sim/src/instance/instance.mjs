import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ADMIN_PASSWORD, HARNESS_DIR, PROJECTS, origin } from "./config.mjs";
import { assertGuard, realProbes } from "./guard.mjs";
import { cloneDir, removeDir } from "./snapshot.mjs";

/** `docker compose` argv and env for one of the harness's projects. */
export function composeInvocation({ project, checkout, dataDir }) {
  const ports = PROJECTS[project];
  if (!ports) throw new Error(`unknown Compose project ${project}`);
  return {
    args: [
      "compose",
      "-p",
      project,
      "--project-directory",
      checkout,
      "-f",
      join(checkout, "compose.dev.yml"),
      "-f",
      join(HARNESS_DIR, "compose.sim.yml"),
      "--profile",
      "mail",
    ],
    env: {
      WGW_DOCKER_HTTP_PORT: String(ports.http),
      WGW_SIM_DATA_DIR: dataDir,
      WGW_SIM_HARNESS_DIR: HARNESS_DIR,
      WGW_SIM_SMTP_PORT: String(ports.smtp),
      WGW_SIM_MAIL_API_PORT: String(ports.mailApi),
      WGW_SIM_ADMIN_PASSWORD: ADMIN_PASSWORD,
    },
  };
}

/**
 * One harness instance: a Compose project on a worktree with a data dir.
 * `shell` runs commands; `fetchImpl` probes health.
 */
export function createInstance({ shell, project, checkout, dataDir, liveDataDir, snapshotsDir, repoRoot, log = () => {}, fetchImpl = fetch }) {
  const inv = composeInvocation({ project, checkout, dataDir });
  const compose = (args, opts = {}) => shell.run("docker", [...inv.args, ...args], { ...opts, env: inv.env });
  const composeStream = (args, opts = {}) => shell.stream("docker", [...inv.args, ...args], { ...opts, env: inv.env });

  function guard() {
    assertGuard({ project, composeFile: join(checkout, "compose.dev.yml"), checkout, dataDir, liveDataDir, snapshotsDir, probes: realProbes(shell) });
  }

  async function ensureDocker(timeoutMs = 180000) {
    if (shell.run("docker", ["info", "--format", "{{.ServerVersion}}"], { allowFail: true, readOnly: true }).status === 0) return;
    log("Docker is not running; starting Docker Desktop");
    if (process.platform === "darwin") shell.run("open", ["-a", "Docker"], { allowFail: true });
    const until = Date.now() + timeoutMs;
    while (Date.now() < until) {
      await sleep(3000);
      if (shell.run("docker", ["info"], { allowFail: true, readOnly: true }).status === 0) return;
    }
    throw new Error("Docker did not come up within 3 minutes");
  }

  function ensureWorktree(ref = "origin/main") {
    if (existsSync(join(checkout, ".git"))) return;
    shell.run("git", ["-C", repoRoot, "fetch", "origin", "--quiet"]);
    shell.run("git", ["-C", repoRoot, "worktree", "add", "--detach", checkout, ref]);
  }

  const sha = () => shell.run("git", ["-C", checkout, "rev-parse", "HEAD"], { readOnly: true }).stdout.trim();

  function fastForward() {
    shell.run("git", ["-C", checkout, "fetch", "origin", "--quiet"]);
    shell.run("git", ["-C", checkout, "checkout", "--detach", "--quiet", "origin/main"]);
  }

  async function build() {
    const tail = (s) => log(s.trimEnd().split("\n").slice(-1)[0]);
    await shell.stream("pnpm", ["install", "--frozen-lockfile"], { cwd: checkout, onOutput: tail });
    await shell.stream("pnpm", ["exec", "turbo", "run", "build", "--filter=@wgw/openapi-types", "--filter=@wgw/apps"], { cwd: checkout, onOutput: tail });
    await shell.stream("pnpm", ["--filter", "@wgw/apps", "run", "sync:runtime"], { cwd: checkout });
    await composeStream(["build"], { onOutput: tail });
    compose(["run", "--rm", "--no-deps", "-T", "--entrypoint", "composer", "web", "install", "--no-interaction", "--prefer-dist", "--working-dir=/var/www/packages/api"]);
  }

  async function start() {
    mkdirSync(dataDir, { recursive: true });
    compose(["up", "-d", "--wait", "--wait-timeout", "300"]);
    if (ensureAppUrl()) compose(["restart", "web", "scheduler"]);
    await waitHealthy();
  }

  /** APP_URL must be this project's origin (dev-install writes :9080 on a fresh install). */
  function ensureAppUrl() {
    const envFile = join(checkout, "packages", "api", ".env");
    if (shell.dryRun || !existsSync(envFile)) return false;
    const want = origin(project);
    const text = readFileSync(envFile, "utf8");
    if (new RegExp(`^APP_URL=${want.replace(/[.]/g, "\\.")}$`, "m").test(text)) return false;
    const next = /^APP_URL=.*$/m.test(text) ? text.replace(/^APP_URL=.*$/m, `APP_URL=${want}`) : `${text.trimEnd()}\nAPP_URL=${want}\n`;
    writeFileSync(envFile, next);
    log(`APP_URL set to ${want}`);
    return true;
  }

  async function waitHealthy(timeoutMs = 180000) {
    if (shell.dryRun) return;
    const url = `${origin(project)}/api/v1/health`;
    const until = Date.now() + timeoutMs;
    let last = "";
    while (Date.now() < until) {
      try {
        const res = await fetchImpl(url);
        if (res.ok) return;
        last = `HTTP ${res.status}`;
      } catch (e) {
        last = e.message;
      }
      await sleep(2000);
    }
    throw new Error(`instance not healthy at ${url}: ${last}`);
  }

  function migrate() {
    const out = compose(["exec", "-T", "-u", "www-data", "web", "php", "artisan", "wgw:schema-migrate", "--no-interaction"]).stdout.trim();
    log(out);
    return out;
  }

  const stopWriters = () => compose(["stop", "web", "scheduler"], { allowFail: true });
  const down = () => compose(["down"], { allowFail: true });
  const artisan = (...args) => compose(["exec", "-T", "-u", "www-data", "web", "php", "artisan", ...args, "--no-interaction"], { allowFail: true });

  /**
   * The upgrade in spec order: stop writers, rollback clone, record SHA,
   * fast-forward, build, start, migrate. On failure: stop, restore data,
   * reset the worktree, rethrow. Ends with the stack up on success.
   */
  async function upgrade({ rollbackDir, steps = {} }) {
    const s = { fastForward, build, start, migrate, ...steps };
    stopWriters();
    removeDir(shell, rollbackDir);
    if (existsSync(dataDir) || shell.dryRun) cloneDir(shell, dataDir, join(rollbackDir, "data"));
    const before = sha();
    try {
      s.fastForward();
      await s.build();
      await s.start();
      const migrated = s.migrate();
      return { ok: true, before, after: sha(), migrated };
    } catch (error) {
      log(`upgrade failed: ${error.message}`);
      rollback({ rollbackDir, sha: before });
      return { ok: false, before, after: before, error: error.message };
    }
  }

  /** Back to the previous night's data and commit; the stack stays stopped. */
  function rollback({ rollbackDir, sha: target }) {
    stopWriters();
    if (existsSync(join(rollbackDir, "data")) || shell.dryRun) {
      removeDir(shell, dataDir);
      shell.run("mv", [join(rollbackDir, "data"), dataDir]);
    }
    shell.run("git", ["-C", checkout, "reset", "--hard", "--quiet", target]);
  }

  return { guard, ensureDocker, ensureWorktree, sha, fastForward, build, start, waitHealthy, migrate, stopWriters, down, upgrade, rollback, artisan, compose, ensureAppUrl, invocation: inv };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
