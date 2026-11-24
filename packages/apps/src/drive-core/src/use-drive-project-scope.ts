import { useEffect, useMemo, useRef } from "react";
import { driveGroupUiPath, uiPathFromApiPath } from "@/lib/files/drive-path-utils";
import type { ViewKey } from "@/lib/files/drive-models";
import { isPersonalFilter, teamSlugOfFilter } from "@/lib/projects/project-filter";
import { selectedProject } from "@/lib/projects/project-match";
import { useProjects, type WorkspaceProject } from "@/lib/projects/projects-store";
import { useProjectFilter } from "@/lib/projects/use-project-filter";

type DriveRoot = { path: string; label: string };

/**
 * Where a Project lives in Drive: its own folder directly under the Team Drive root, the
 * default Project's included. Null when it has none (archived, or the server has not made it yet).
 */
export function driveProjectFolderUiPath(
  project: Pick<WorkspaceProject, "resources">,
): string | null {
  const apiPath = project.resources.driveFolderPath;
  return apiPath ? uiPathFromApiPath(apiPath, "") : null;
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
  // A Team filter shows the whole Team Drive (everything of the Team); a Project, its own folder.
  const folderPath = project
    ? driveProjectFolderUiPath(project)
    : teamSlug !== null
      ? driveGroupUiPath(teamSlug)
      : null;
  const label = project
    ? project.name
    : (groupRoots.find((root) => root.path === folderPath)?.label ?? teamSlug ?? "");

  // "Personal": only the user's own drive; no Team Drives, no Project folders.
  const personal = isPersonalFilter(filter);
  const targetPath = personal ? "My Drive" : folderPath;
  const scopedRoots = useMemo(
    () => (personal ? [] : folderPath ? [{ path: folderPath, label }] : groupRoots),
    [folderPath, groupRoots, label, personal],
  );

  // Open the folder when the Project changes, and on entry when Drive opens on Home.
  const shownForRef = useRef<string | null | undefined>(undefined);
  const viewRef = useRef(view);
  viewRef.current = view;
  useEffect(() => {
    const first = shownForRef.current === undefined;
    if (shownForRef.current === targetPath) return;
    shownForRef.current = targetPath;
    if (!targetPath || isInside(viewRef.current, targetPath)) return;
    if (first && viewRef.current.type !== "all") return;
    selectView({ type: "folder", path: targetPath });
  }, [targetPath, selectView]);

  return { groupRoots: scopedRoots, hidePersonalDrive: folderPath !== null };
}
