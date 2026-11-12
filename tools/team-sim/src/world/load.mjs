import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, resolve } from "node:path";
import { addDays } from "../planner/dates.mjs";

export const WORLD_DIR = resolve(fileURLToPath(import.meta.url), "..", "..", "..", "world");

const PHASES = ["intake", "kickoff", "strategy", "design", "production", "close"];
/** Days after the close phase starts that a project still has activity. */
const CLOSE_DAYS = 5;

export function loadWorld(dir = WORLD_DIR) {
  const read = (name) => JSON.parse(readFileSync(join(dir, `${name}.json`), "utf8"));
  return createWorld({
    meta: read("world"),
    personas: read("personas"),
    teams: read("teams"),
    clients: read("clients"),
    projects: read("projects"),
    rhythm: read("rhythm"),
  });
}

/** Wraps raw world data with the lookups the planner, reconciler and oracles share. */
export function createWorld(raw) {
  const persona = (id) => {
    const p = raw.personas.find((x) => x.id === id);
    if (!p) throw new Error(`unknown persona ${id}`);
    return p;
  };
  const teamsOf = (id) => raw.teams.filter((t) => t.members.includes(id)).map((t) => t.id);
  const sharesTeam = (a, b) => teamsOf(a).some((t) => teamsOf(b).includes(t));
  const startedBy = (id, date) => persona(id).startDate <= date;
  const personasOn = (date) => raw.personas.filter((p) => p.startDate <= date).map((p) => p.id);
  const teamMembersOn = (teamId, date) =>
    raw.teams.find((t) => t.id === teamId).members.filter((m) => startedBy(m, date));

  const phaseOf = (project, date) => {
    let current = null;
    for (const name of PHASES) if (project.phases[name] <= date) current = name;
    if (current === "close" && addDays(project.phases.close, CLOSE_DAYS) < date) return "done";
    return current;
  };
  const projectsOn = (date) =>
    raw.projects
      .map((p) => ({ ...p, phase: phaseOf(p, date) }))
      .filter((p) => p.phase && p.phase !== "done");
  const projectMembersOn = (project, date) => project.members.filter((m) => startedBy(m, date));
  /** A scope is a Team id; a persona may read an object scoped to a Team they are in. */
  const canRead = (personaId, scope) => {
    if (!scope) return true;
    if (scope.startsWith("own:")) return scope === `own:${personaId}`;
    if (scope.startsWith("dm:")) return scope.slice(3).split("+").includes(personaId);
    return teamsOf(personaId).includes(scope);
  };
  const zoneOf = (id, date) =>
    persona(id).timeZones?.find((z) => z.from <= date && date <= z.to)?.zone ?? raw.meta.timeZone;
  const email = (id) => `${id}@${raw.meta.internalDomain}`;
  const client = (id) => raw.clients.find((c) => c.id === id);

  return Object.freeze({
    ...raw,
    phases: PHASES,
    persona,
    teamsOf,
    sharesTeam,
    startedBy,
    personasOn,
    teamMembersOn,
    phaseOf,
    projectsOn,
    projectMembersOn,
    canRead,
    zoneOf,
    email,
    client,
  });
}
