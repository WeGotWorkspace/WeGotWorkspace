import type { ProjectOperations, ProjectTeam } from "@/lib/api/wgw/projects";
import { WgwRequestError } from "@/lib/api/wgw/request-error";
import type { Project } from "@wgw/openapi-types/projects-types";

const PALETTE = ["#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#ec4899"];

export const MOCK_PROJECT_TEAMS: ProjectTeam[] = [
  { slug: "design", displayName: "Design", isTeamAdmin: true },
  { slug: "sales", displayName: "Sales", isTeamAdmin: false },
];

function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "project"
  );
}

function mockProject(team: ProjectTeam, name: string, index: number, isDefault = false): Project {
  const id = `01mockproject${String(index).padStart(13, "0")}`;
  const slug = slugify(name);
  return {
    id,
    teamSlug: team.slug,
    slug,
    name,
    color: PALETTE[index % PALETTE.length] ?? null,
    isDefault,
    archived: false,
    archivedAt: null,
    mayManage: team.isTeamAdmin,
    resources: {
      calendarId: `cal-${id}`,
      taskListId: `tasks-${id}`,
      notebookId: `notes-${id}`,
      channelId: `chat-${id}`,
      driveFolderId: `folder-${id}`,
      driveFolderPath: `groups/${team.slug}/${name}`,
    },
  } satisfies Project;
}

/** In-memory Projects for Storybook, Vitest and the mock dev server. */
export function createMockProjectOperations(
  teams: ProjectTeam[] = MOCK_PROJECT_TEAMS,
): ProjectOperations {
  let next = 0;
  const projects: Project[] = [];
  for (const team of teams) {
    projects.push(mockProject(team, `${team.displayName} Project`, next++, true));
  }
  const design = teams[0];
  if (design) projects.push(mockProject(design, "Website relaunch", next++));

  const find = (id: string): Project => {
    const found = projects.find((project) => project.id === id);
    if (!found) throw new WgwRequestError("Project not found", 404);
    return found;
  };
  const manageable = (id: string): Project => {
    const found = find(id);
    if (!found.mayManage) throw new WgwRequestError("Only a team admin can do this", 403);
    return found;
  };
  const replace = (updated: Project): Project => {
    projects[projects.findIndex((project) => project.id === updated.id)] = updated;
    return updated;
  };

  return {
    list: async (opts) =>
      projects.filter((project) => project.archived === Boolean(opts?.archived)),
    listTeams: async () => ({ username: "admin", teams: teams.map((team) => ({ ...team })) }),
    create: async ({ teamSlug, name, color }) => {
      const team = teams.find((candidate) => candidate.slug === teamSlug);
      if (!team?.isTeamAdmin) throw new WgwRequestError("Only a team admin can do this", 403);
      if (!name.trim()) throw new WgwRequestError("A Project needs a name", 422);
      const created = mockProject(team, name.trim(), next++);
      if (color) created.color = color;
      projects.push(created);
      return created;
    },
    patch: async (id, patch) => {
      const project = manageable(id);
      if (project.archived) {
        throw new WgwRequestError(
          "An archived Project cannot be changed. Unarchive it first.",
          409,
        );
      }
      return replace({ ...project, ...patch });
    },
    archive: async (id) => {
      const project = manageable(id);
      if (project.isDefault) throw new WgwRequestError("The default Project stays", 409);
      return replace({ ...project, archived: true, archivedAt: new Date().toISOString() });
    },
    unarchive: async (id) => replace({ ...manageable(id), archived: false, archivedAt: null }),
    purge: async (id) => {
      const project = manageable(id);
      if (project.isDefault) throw new WgwRequestError("The default Project stays", 409);
      if (!project.archived) throw new WgwRequestError("Archive the Project first", 409);
      projects.splice(
        projects.findIndex((entry) => entry.id === id),
        1,
      );
    },
  };
}
