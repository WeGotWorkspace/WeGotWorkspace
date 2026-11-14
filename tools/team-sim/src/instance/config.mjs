import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const HARNESS_DIR = resolve(fileURLToPath(import.meta.url), "..", "..", "..");

/** The two Compose projects the harness may run, with their host ports. */
export const PROJECTS = Object.freeze({
  "wgw-sim": { http: 9290, smtp: 2590, mailApi: 2580 },
  "wgw-sim-replay": { http: 9291, smtp: 2591, mailApi: 2581 },
});

/** Dev (:9080/:5173/:4173, mail :1025/:8025) and the maintainer's PR test ports (:9090/:5190/:4190). */
export const FORBIDDEN_PORTS = Object.freeze([9080, 5173, 4173, 1025, 8025, 9090, 5190, 4190]);

/** Local-only passwords for a local-only instance. Not secrets: the instance listens on 127.0.0.1. */
export const ADMIN_PASSWORD = "team-sim-admin-local";
export const personaPassword = (id) => `kade-${id}-local-2026`;

export function simHome(env = process.env) {
  return resolve(env.WGW_SIM_HOME || join(homedir(), ".wgw-sim"));
}

/** Every path the harness writes, under one home. */
export function layout(home = simHome()) {
  return {
    home,
    checkout: join(home, "checkout"),
    data: join(home, "data"),
    rollback: join(home, "rollback"),
    snapshots: join(home, "snapshots"),
    runs: join(home, "runs"),
    reports: join(home, "reports"),
    replay: join(home, "replay"),
    lastNight: join(home, "last-night.json"),
    knownIssues: join(home, "known-issues.json"),
    flaky: join(home, "flaky.json"),
    nightsLog: join(home, "nights.json"),
  };
}

/** Harness state inside the data dir, so every snapshot carries it. */
export const stateDir = (dataDir) => join(dataDir, ".team-sim");

export const origin = (project) => `http://127.0.0.1:${PROJECTS[project].http}`;
