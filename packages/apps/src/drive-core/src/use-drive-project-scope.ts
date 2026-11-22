import { useEffect, useMemo, useRef } from "react";
import { driveGroupUiPath, uiPathFromApiPath } from "@/lib/files/drive-path-utils";
import type { ViewKey } from "@/lib/files/drive-models";
import { teamSlugOfFilter } from "@/lib/projects/project-filter";
import { selectedProject } from "@/lib/projects/project-match";
import { useProjects, type WorkspaceProject } from "@/lib/projects/projects-store";
import { useProjectFilter } from "@/lib/projects/use-project-filter";

type DriveRoot = { path: string; label: string };

/**
 * Where a Project lives in Drive: its own folder, or the whole Team Drive for a
 * default Project (it has no folder of its own). Null when it has neither (archived).
 */
export function driveProjectFolderUiPath(
  project: Pick<WorkspaceProject, "isDefault" | "teamSlug" | "resources">,
): string | null {
  const apiPath = project.resources.driveFolderPath;
  if (apiPath) return uiPathFromApiPath(apiPath, "");
  return project.isDefault ? driveGroupUiPath(project.teamSlug) : null;
}

function isInside(view: ViewKey, path: string): boolean {
  return view.type === "folder" && (view.path === path || view.path.startsWith(`${path}/`));
}

/**
 * The Project filter in Drive and Docs (#818 C3). With a Project (or a Team: its whole Team Drive) selected the sidebar
 * lists only its folder (under the Project's name, no personal drive, no other Teams),
 * and choosing the Project opens that folder. Home, Recent, Starred and Trash stay.
 */
export function useDriveProjectScope({
  view,
  groupRoots,
  selectView,
}: {
  view: ViewKey;
  groupRoots: readonly DriveRoot[];
  selectView: (view: ViewKey) => void;
}): { groupRoots: readonly DriveRoot[]; hidePersonalDrive: boolean } {
  const [filter] = useProjectFilter();
  const { projects } = useProjects();
  const project = selectedProject(filter, projects);
  const teamSlug = teamSlugOfFilter(filter);
  // A Team filter shows the whole Team Drive, like the Team's default Project.
  const folderPath = project
    ? driveProjectFolderUiPath(project)
    : teamSlug !== null
      ? driveGroupUiPath(teamSlug)
      : null;
  const label = project
    ? project.name
    : (groupRoots.find((root) => root.path === folderPath)?.label ?? teamSlug ?? "");

  const scopedRoots = useMemo(
    () => (folderPath ? [{ path: folderPath, label }] : groupRoots),
    [folderPath, groupRoots, label],
  );

  // Open the folder when the Project changes, and on entry when Drive opens on Home.
  const shownForRef = useRef<string | null | undefined>(undefined);
  const viewRef = useRef(view);
  viewRef.current = view;
  useEffect(() => {
    const first = shownForRef.current === undefined;
    if (shownForRef.current === folderPath) return;
    shownForRef.current = folderPath;
    if (!folderPath || isInside(viewRef.current, folderPath)) return;
    if (first && viewRef.current.type !== "all") return;
    selectView({ type: "folder", path: folderPath });
  }, [folderPath, selectView]);

  return { groupRoots: scopedRoots, hidePersonalDrive: folderPath !== null };
}
