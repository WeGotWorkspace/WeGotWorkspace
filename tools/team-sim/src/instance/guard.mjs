import { existsSync, realpathSync, statSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { FORBIDDEN_PORTS, PROJECTS } from "./config.mjs";

/**
 * Refuses anything that could touch the maintainer's dev or PR-test
 * instance. Pure over `probes`, so tests drive every branch:
 *   probes.portOwner(port) -> null | { composeProject } | { other }
 *   probes.gitRoot(dir)    -> path of the enclosing checkout or null
 *   probes.device(dir)     -> volume id
 */
export function guardProblems({ project, composeFile, checkout, dataDir, liveDataDir, snapshotsDir, probes }) {
  const problems = [];
  const ports = PROJECTS[project];
  if (!ports) {
    problems.push(`Compose project "${project}" is not wgw-sim or wgw-sim-replay`);
    return problems;
  }
  for (const [name, port] of Object.entries(ports)) {
    if (FORBIDDEN_PORTS.includes(port)) problems.push(`${name} port ${port} is a dev or PR-test port`);
    const owner = probes.portOwner(port);
    if (!owner) continue;
    if (owner.composeProject === project) continue;
    problems.push(
      owner.composeProject
        ? `port ${port} is taken by Compose project "${owner.composeProject}"`
        : `port ${port} is taken by another process (${owner.other})`,
    );
  }
  const expected = join(resolve(checkout), "compose.dev.yml");
  if (resolve(composeFile) !== expected) problems.push(`compose file ${composeFile} is outside the sim worktree (${expected})`);
  const root = probes.gitRoot(dataDir);
  if (root) problems.push(`data dir ${dataDir} is inside the git checkout ${root}`);
  if (project === "wgw-sim-replay" && liveDataDir && samePath(dataDir, liveDataDir)) {
    problems.push(`wgw-sim-replay may not use the live data dir ${liveDataDir}`);
  }
  if (snapshotsDir && probes.device(dataDir) !== probes.device(snapshotsDir)) {
    problems.push(`data dir and snapshot dir are on different volumes (clonefile needs one volume)`);
  }
  return problems;
}

export function assertGuard(args) {
  const problems = guardProblems(args);
  if (problems.length) throw new Error(`team-sim guard refused:\n- ${problems.join("\n- ")}`);
}

const samePath = (a, b) => resolve(a) === resolve(b);

/** Nearest existing ancestor (the data dir may not exist yet). */
export function existingAncestor(path) {
  let p = resolve(path);
  while (!existsSync(p)) p = dirname(p);
  return p;
}

export function realProbes(shell) {
  return {
    portOwner(port) {
      const ps = shell.run("docker", ["ps", "--filter", `publish=${port}`, "--format", '{{.Label "com.docker.compose.project"}}'], { allowFail: true, readOnly: true });
      const project = ps.stdout.trim().split("\n").filter(Boolean)[0];
      if (project) return { composeProject: project };
      const lsof = shell.run("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN"], { allowFail: true, readOnly: true });
      const line = lsof.stdout.trim().split("\n")[1];
      return line ? { other: line.split(/\s+/).slice(0, 2).join(" pid ") } : null;
    },
    gitRoot(dir) {
      let p = realpathSync(existingAncestor(dir));
      for (;;) {
        if (existsSync(join(p, ".git"))) return p;
        const up = dirname(p);
        if (up === p) return null;
        p = up;
      }
    },
    device: (dir) => statSync(existingAncestor(dir)).dev,
  };
}

export const isInside = (child, parent) => resolve(child).startsWith(resolve(parent) + sep);
