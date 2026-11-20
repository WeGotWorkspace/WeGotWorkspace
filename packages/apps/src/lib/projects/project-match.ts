import { projectIdOfFilter, type ProjectFilterValue } from "@/lib/projects/project-filter";
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
  projectId: string | null,
): T[] {
  if (projectId === null) return [...collections];
  return collections.filter((collection) => collection.projectId === projectId);
}

/** A Project collection: its name, color and lifetime follow the Project. */
export function isProjectCollection(collection: { projectId?: string | null }): boolean {
  return typeof collection.projectId === "string" && collection.projectId !== "";
}
