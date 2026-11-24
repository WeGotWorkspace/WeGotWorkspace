import {
  PERSONAL_PROJECT_ID,
  projectIdOfFilter,
  teamSlugOfFilter,
  type ProjectFilterValue,
} from "@/lib/projects/project-filter";
import type { WorkspaceProject } from "@/lib/projects/projects-store";

/** The resource of a Project each app narrows to (#818 C3). */
export type ProjectResourceKind =
  "calendarId" | "taskListId" | "notebookId" | "channelId" | "driveFolderId";

/** The Project the filter narrows to, or null for "All Projects" or an unknown id. */
export function selectedProject(
  filter: ProjectFilterValue,
  projects: readonly WorkspaceProject[],
): WorkspaceProject | null {
  const id = projectIdOfFilter(filter);
  return id === null ? null : (projects.find((project) => project.id === id) ?? null);
}

/** The Team the filter narrows to: a Team filter's own, or the selected Project's. Null for "All Projects". */
export function selectedTeamSlug(
  filter: ProjectFilterValue,
  projects: readonly WorkspaceProject[],
): string | null {
  return teamSlugOfFilter(filter) ?? selectedProject(filter, projects)?.teamSlug ?? null;
}

/**
 * The ids the filter keeps: one Project; for a Team filter every Project of the Team plus
 * `team:<slug>` (its collections in no Project); null for "All Teams" (no narrowing); the
 * personal id for "Personal" (collections in no Team and no Project).
 */
export const TEAM_SCOPE_PREFIX = "team:";

export function projectIdsInScope(
  filter: ProjectFilterValue,
  projects: readonly WorkspaceProject[],
): string[] | null {
  if (filter === "personal") return [PERSONAL_PROJECT_ID];
  const projectId = projectIdOfFilter(filter);
  if (projectId !== null) return [projectId];
  const teamSlug = teamSlugOfFilter(filter);
  if (teamSlug === null) return null;
  // The Team's own collections that are in no Project ride along as `team:<slug>`.
  return [
    ...projects.filter((project) => project.teamSlug === teamSlug).map((project) => project.id),
    `${TEAM_SCOPE_PREFIX}${teamSlug}`,
  ];
}

/** The Project a collection belongs to, for labels and badges. */
export function projectOfCollection(
  projects: readonly WorkspaceProject[],
  kind: ProjectResourceKind,
  collectionId: string,
): WorkspaceProject | null {
  return projects.find((project) => project.resources[kind] === collectionId) ?? null;
}

/**
 * Collections under the filter, by the `projectId` the server sends on each JMAP
 * collection (#817 B1). "All Teams" keeps every collection; a Project keeps only its own;
 * a Team keeps its Projects' collections and its own collections in no Project; "Personal"
 * keeps collections in no Project and no Team.
 */
export function collectionsInProject<
  T extends { projectId?: string | null; groupSlug?: string | null },
>(collections: readonly T[], scope: string | readonly string[] | null): T[] {
  if (scope === null) return [...collections];
  const ids = typeof scope === "string" ? [scope] : scope;
  const teams = ids
    .filter((id) => id.startsWith(TEAM_SCOPE_PREFIX))
    .map((id) => id.slice(TEAM_SCOPE_PREFIX.length));
  return collections.filter((collection) => {
    const projectId = collection.projectId ?? PERSONAL_PROJECT_ID;
    if (projectId !== PERSONAL_PROJECT_ID) return ids.includes(projectId);
    const team = collection.groupSlug?.trim();
    return team ? teams.includes(team) : ids.includes(PERSONAL_PROJECT_ID);
  });
}

/** A Project collection: its name, color and lifetime follow the Project. */
export function isProjectCollection(collection: { projectId?: string | null }): boolean {
  return typeof collection.projectId === "string" && collection.projectId !== "";
}
