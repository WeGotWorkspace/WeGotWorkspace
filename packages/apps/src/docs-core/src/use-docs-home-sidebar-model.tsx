import { useMemo } from "react";
import { Files, HardDrive } from "lucide-react";
import { DriveViewIcon } from "@/drive-core/src/drive-view-icons";
import { FILES_BROWSER_SIDEBAR_PRIMARY_ORDER } from "@/drive-core/src/files-browser-sidebar";
import type { MenuItemProps } from "@/menu-item/src/menu-item";
import type { DocsUILabels } from "@/docs-core/src/docs-labels";
import type { DocsHomeDrive } from "@/docs-core/src/docs-home-drives";
import type { DocsHomeView } from "@/docs-core/src/docs-home-shared";

type UseDocsHomeSidebarModelArgs = {
  labels: DocsUILabels;
  drives: DocsHomeDrive[];
  view: DocsHomeView;
  selectView: (view: DocsHomeView) => void;
};

export function useDocsHomeSidebarModel({
  labels,
  drives,
  view,
  selectView,
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
      trash: {
        label: labels.homeTrash,
        icon: <DriveViewIcon view={{ type: "folder", path: "Trash" }} />,
        selected: view.type === "trash",
        onClick: () => selectView({ type: "trash" }),
      },
    } satisfies Record<(typeof FILES_BROWSER_SIDEBAR_PRIMARY_ORDER)[number], MenuItemProps>;

    return FILES_BROWSER_SIDEBAR_PRIMARY_ORDER.map((id) => byId[id]);
  }, [
    labels.homeAllDocs,
    labels.homeRecent,
    labels.homeSharedWithMe,
    labels.homeStarred,
    labels.homeTrash,
    selectView,
    view.type,
  ]);

  const driveItems = useMemo<MenuItemProps[]>(
    () =>
      drives.map((drive) => ({
        label: drive.label,
        icon: <HardDrive className="size-3.5" />,
        selected: view.type === "drive" && view.pathPrefix === drive.pathPrefix,
        onClick: () => selectView({ type: "drive", pathPrefix: drive.pathPrefix }),
      })),
    [drives, selectView, view],
  );

  return { primaryItems, driveItems };
}
