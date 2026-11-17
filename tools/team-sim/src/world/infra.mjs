/**
 * The standing structure the world implies on a date: Team channels from the
 * epoch, and per project a channel, task list and Drive folder from its
 * kick-off date. Pure function of (world, date); the reconciler creates what
 * is missing and the planner assumes it exists.
 */
export function infraOn(world, date) {
  const items = [];
  for (const team of world.teams) {
    if (world.meta.epoch > date) continue;
    items.push({ key: `channel:team:${team.id}`, type: "channel", name: team.name, scope: team.id, owner: ownerOfTeam(world, team) });
    items.push({ key: `folder:team:${team.id}`, type: "folder", name: team.name, scope: team.id, owner: ownerOfTeam(world, team) });
  }
  for (const project of world.projects) {
    if (project.phases.kickoff > date) continue;
    const base = { project: project.id, scope: project.team, owner: project.pm };
    items.push({ ...base, key: `channel:project:${project.id}`, type: "channel", name: project.name });
    items.push({ ...base, key: `tasklist:project:${project.id}`, type: "tasklist", name: project.name });
    items.push({ ...base, key: `folder:project:${project.id}`, type: "folder", name: project.name });
  }
  return items;
}

/** The first started member that is a project manager, else the first member. */
function ownerOfTeam(world, team) {
  const pms = team.members.filter((m) => world.persona(m).role === "pm");
  return pms[0] ?? team.members[0];
}
