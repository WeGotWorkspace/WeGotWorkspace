import { useMemo } from "react";
import { Files, HardDrive } from "lucide-react";
import { DriveViewIcon } from "@/drive-core/src/drive-view-icons";
import { FILES_BROWSER_SIDEBAR_PRIMARY_ORDER } from "@/drive-core/src/files-browser-sidebar";
import type { MenuItemProps } from "@/menu-item/src/menu-item";
import type { DocsUILabels } from "@/docs-core/src/docs-labels";
import type { DocsHomeDrive } from "@/docs-core/src/docs-home-drives";
import type { DocsHomeView } from "@/docs-core/src/docs-home-shared";
import { docsProjectPathPrefix } from "@/docs-core/src/use-docs-project-scope";
import { projectsWithFolder } from "@/drive-core/src/drive-project-folder";
import { ProjectMark } from "@/projects-ui/src/project-mark";
import type { WorkspaceProject } from "@/lib/projects/projects-store";

type UseDocsHomeSidebarModelArgs = {
  labels: DocsUILabels;
  drives: DocsHomeDrive[];
  view: DocsHomeView;
  selectView: (view: DocsHomeView) => void;
  /** The suite's Projects; those with a Drive folder get their own section. */
  projects?: readonly WorkspaceProject[];
  /** The Project ids the filter keeps; null for "All Teams". */
  selectedProjectIds?: readonly string[] | null;
};

export function useDocsHomeSidebarModel({
  labels,
  drives,
  view,
  selectView,
  projects = [],
  selectedProjectIds = null,
}: UseDocsHomeSidebarModelArgs) {
  const primaryItems = useMemo<MenuItemProps[]>(() => {
    const byId = {
      home: {
        label: labels.homeAllDocs,
        icon: <Files className="size-3.5" />,
        selected: view.type === "all",
        onClick: () => selectView({ type: "all" }),
      },
      shared: {
        label: labels.homeSharedWithMe,
        icon: <DriveViewIcon view={{ type: "shared" }} />,
        selected: view.type === "shared",
        onClick: () => selectView({ type: "shared" }),
      },
      recent: {
        label: labels.homeRecent,
        icon: <DriveViewIcon view={{ type: "recent" }} />,
        selected: view.type === "recent",
        onClick: () => selectView({ type: "recent" }),
      },
      starred: {
        label: labels.homeStarred,
        icon: <DriveViewIcon view={{ type: "starred" }} />,
        selected: view.type === "starred",
        onClick: () => selectView({ type: "starred" }),
      },
      // Docs has no upload queue: files reach Drive's Uploads view, not Docs home.
      uploads: null,
      trash: {
        label: labels.homeTrash,
        icon: <DriveViewIcon view={{ type: "folder", path: "Trash" }} />,
        selected: view.type === "trash",
        onClick: () => selectView({ type: "trash" }),
      },
    } satisfies Record<(typeof FILES_BROWSER_SIDEBAR_PRIMARY_ORDER)[number], MenuItemProps | null>;

    return FILES_BROWSER_SIDEBAR_PRIMARY_ORDER.flatMap((id) => byId[id] ?? []);
  }, [
    labels.homeAllDocs,
    labels.homeRecent,
    labels.homeSharedWithMe,
    labels.homeStarred,
    labels.homeTrash,
    selectView,
    view.type,
  ]);

  const projectEntries = useMemo(
    () =>
      projectsWithFolder(projects)
        .filter((project) => !selectedProjectIds || selectedProjectIds.includes(project.id))
        .flatMap((project) => {
          const prefix = docsProjectPathPrefix(project);
          return prefix ? [{ project, prefix }] : [];
        }),
    [projects, selectedProjectIds],
  );

  // A Project folder lives inside its Team drive, which lists only its root: no duplicates.
  const driveItems = useMemo<MenuItemProps[]>(
    () =>
      drives
        .filter(
          (drive) =>
            !projectEntries.some(
              ({ prefix }) => drive.pathPrefix?.toLowerCase() === prefix.toLowerCase(),
            ),
        )
        .map((drive) => ({
          label: drive.label,
          icon: <HardDrive className="size-3.5" />,
          selected: view.type === "drive" && view.pathPrefix === drive.pathPrefix,
          onClick: () => selectView({ type: "drive", pathPrefix: drive.pathPrefix }),
        })),
    [drives, projectEntries, selectView, view],
  );

  const projectItems = useMemo<MenuItemProps[]>(
    () =>
      projectEntries.map(({ project, prefix }) => ({
        label: project.name,
        icon: <ProjectMark color={project.color} />,
        selected: view.type === "drive" && view.pathPrefix?.toLowerCase() === prefix.toLowerCase(),
        onClick: () => selectView({ type: "drive", pathPrefix: prefix }),
      })),
    [projectEntries, selectView, view],
  );

  return { primaryItems, driveItems, projectItems };
}
