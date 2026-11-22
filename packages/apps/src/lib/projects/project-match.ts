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
 * The ids of the Projects the filter keeps: one for a Project, every Project of the Team
 * for a Team filter, null for "All Teams" (no narrowing), and the personal id for "Personal".
 */
export function projectIdsInScope(
  filter: ProjectFilterValue,
  projects: readonly WorkspaceProject[],
): string[] | null {
  if (filter === "personal") return [PERSONAL_PROJECT_ID];
  const projectId = projectIdOfFilter(filter);
  if (projectId !== null) return [projectId];
  const teamSlug = teamSlugOfFilter(filter);
  if (teamSlug === null) return null;
  return projects.filter((project) => project.teamSlug === teamSlug).map((project) => project.id);
}

/** True when a collection shows under the filter: always for "All Projects". */
export function collectionMatchesProjectFilter(
  filter: ProjectFilterValue,
  projects: readonly WorkspaceProject[],
  kind: ProjectResourceKind,
  collectionId: string,
): boolean {
  if (filter === "all") return true;
  const project = selectedProject(filter, projects);
  return project === null || project.resources[kind] === collectionId;
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
 * collection (#817 B1). "All Projects" keeps every collection; a Project keeps only its own.
 */
export function collectionsInProject<T extends { projectId?: string | null }>(
  collections: readonly T[],
  scope: string | readonly string[] | null,
): T[] {
  if (scope === null) return [...collections];
  const ids = typeof scope === "string" ? [scope] : scope;
  // A collection without a Project reads as the personal id.
  return collections.filter((collection) =>
    ids.includes(collection.projectId ?? PERSONAL_PROJECT_ID),
  );
}

/** A Project collection: its name, color and lifetime follow the Project. */
export function isProjectCollection(collection: { projectId?: string | null }): boolean {
  return typeof collection.projectId === "string" && collection.projectId !== "";
}
