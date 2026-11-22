import { Folder, FolderKanban, type LucideIcon } from "lucide-react";
import { useMemo } from "react";
import { normalizeApiVirtualPath, uiPathFromApiPath } from "@/lib/files/drive-path-utils";
import type { DriveFile } from "@/lib/files/drive-models";
import { useProjects, type WorkspaceProject } from "@/lib/projects/projects-store";

type ProjectFolderRef = Pick<WorkspaceProject, "resources">;

/** The live Projects that own a Drive folder, the default Project of each Team included. */
export function projectsWithFolder<T extends ProjectFolderRef & { archived?: boolean }>(
  projects: readonly T[],
): T[] {
  return projects.filter(
    (project) =>
      !project.archived &&
      Boolean(project.resources.driveFolderId || project.resources.driveFolderPath),
  );
}

/** True when the folder (node id or API path) is a Project's Drive folder. */
export function isProjectFolder(
  node: Partial<Pick<DriveFile, "id" | "apiPath">>,
  projects: readonly (ProjectFolderRef & { archived?: boolean })[],
): boolean {
  const apiPath = node.apiPath ? normalizeApiVirtualPath(node.apiPath) : "";
  return projectsWithFolder(projects).some(({ resources }) => {
    if (node.id && resources.driveFolderId && node.id === resources.driveFolderId) return true;
    return Boolean(
      apiPath &&
      resources.driveFolderPath &&
      normalizeApiVirtualPath(resources.driveFolderPath) === apiPath,
    );
  });
}

/** The live Project whose Drive folder this is (node id or API path), if any. */
export function projectOfFolder<T extends ProjectFolderRef & { archived?: boolean }>(
  node: Partial<Pick<DriveFile, "id" | "apiPath">>,
  projects: readonly T[],
): T | null {
  const apiPath = node.apiPath ? normalizeApiVirtualPath(node.apiPath) : "";
  return (
    projectsWithFolder(projects).find(({ resources }) => {
      if (node.id && resources.driveFolderId && node.id === resources.driveFolderId) return true;
      return Boolean(
        apiPath &&
        resources.driveFolderPath &&
        normalizeApiVirtualPath(resources.driveFolderPath) === apiPath,
      );
    }) ?? null
  );
}

/** True when a Drive UI path (`Groups/{team}/{Project}`) is a Project's folder. */
export function isProjectFolderUiPath(
  uiPath: string,
  projects: readonly (ProjectFolderRef & { archived?: boolean })[],
): boolean {
  return projectsWithFolder(projects).some(
    ({ resources }) =>
      Boolean(resources.driveFolderPath) &&
      uiPathFromApiPath(resources.driveFolderPath as string, "") === uiPath,
  );
}

/** The folder icon a row shows: the Project icon for a Project folder, else `fallback`. */
export function driveFolderIcon(isProject: boolean, fallback: LucideIcon = Folder): LucideIcon {
  return isProject ? FolderKanban : fallback;
}

/** Predicates over the suite's Projects, for the places that render or guard folders. */
export function useProjectFolders(): {
  isProjectFolder: (node: Partial<Pick<DriveFile, "id" | "apiPath">>) => boolean;
  /** The Project (for its color) whose folder this is, or null. */
  projectOfFolder: (node: Partial<Pick<DriveFile, "id" | "apiPath">>) => WorkspaceProject | null;
  isProjectFolderUiPath: (uiPath: string) => boolean;
} {
  const { projects } = useProjects();
  return useMemo(
    () => ({
      isProjectFolder: (node) => isProjectFolder(node, projects),
      projectOfFolder: (node) => projectOfFolder(node, projects),
      isProjectFolderUiPath: (uiPath) => isProjectFolderUiPath(uiPath, projects),
    }),
    [projects],
  );
}
