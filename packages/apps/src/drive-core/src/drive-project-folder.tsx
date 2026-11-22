import { Folder, FolderKanban, type LucideIcon } from "lucide-react";
import { useMemo } from "react";
import { normalizeApiVirtualPath, uiPathFromApiPath } from "@/lib/files/drive-path-utils";
import type { DriveFile } from "@/lib/files/drive-models";
import { useProjects, type WorkspaceProject } from "@/lib/projects/projects-store";

type ProjectFolderRef = Pick<WorkspaceProject, "resources">;

/** The Projects that own a Drive folder of their own: the default Project uses the whole Team drive. */
export function projectsWithFolder<
  T extends ProjectFolderRef & { isDefault?: boolean; archived?: boolean },
>(projects: readonly T[]): T[] {
  return projects.filter(
    (project) =>
      !project.isDefault &&
      !project.archived &&
      Boolean(project.resources.driveFolderId || project.resources.driveFolderPath),
  );
}

/** True when the folder (node id or API path) is a Project's Drive folder. */
export function isProjectFolder(
  node: Partial<Pick<DriveFile, "id" | "apiPath">>,
  projects: readonly (ProjectFolderRef & { isDefault?: boolean; archived?: boolean })[],
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

/** True when a Drive UI path (`Groups/{team}/{Project}`) is a Project's folder. */
export function isProjectFolderUiPath(
  uiPath: string,
  projects: readonly (ProjectFolderRef & { isDefault?: boolean; archived?: boolean })[],
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
  isProjectFolderUiPath: (uiPath: string) => boolean;
} {
  const { projects } = useProjects();
  return useMemo(
    () => ({
      isProjectFolder: (node) => isProjectFolder(node, projects),
      isProjectFolderUiPath: (uiPath) => isProjectFolderUiPath(uiPath, projects),
    }),
    [projects],
  );
}
