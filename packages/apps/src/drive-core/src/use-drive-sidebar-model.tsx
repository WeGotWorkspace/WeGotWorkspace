import { useMemo } from "react";
import { Files, HardDrive } from "lucide-react";
import { DriveViewIcon } from "@/drive-core/src/drive-view-icons";
import { FILES_BROWSER_SIDEBAR_PRIMARY_ORDER } from "@/drive-core/src/files-browser-sidebar";
import type { ViewKey } from "@/drive-core/src/drive-models";
import type { DriveUILabels } from "@/drive-core/src/drive-labels";
import type { MenuItemProps } from "@/menu-item/src/menu-item";
import { DriveUploadsBadge } from "@/drive-core/src/drive-uploads-badge";

type UseDriveSidebarModelArgs = {
  labels: DriveUILabels;
  view: ViewKey;
  /** Files in the upload queue, or null when this Drive has no queue. */
  uploads?: { count: number; failed: number } | null;
  /** Group drive roots with display labels (path key + SST label). */
  sidebarGroupRoots: ReadonlyArray<{ path: string; label: string }>;
  selectView: (view: ViewKey) => void;
  sidebarDropZoneProps: (
    targetKey: string,
    onDrop: (ids: string[]) => void,
  ) => Pick<
    MenuItemProps,
    "isDropTarget" | "onDragEnter" | "onDragOver" | "onDragLeave" | "onDrop"
  >;
  commitMoveToFolder: (ids: string[], destinationPath: string) => void;
};

function isMyDriveView(view: ViewKey) {
  return view.type === "folder" && (view.path === "My Drive" || view.path.startsWith("My Drive/"));
}

function isTrashView(view: ViewKey) {
  return view.type === "folder" && (view.path === "Trash" || view.path.startsWith("Trash/"));
}

function isGroupView(view: ViewKey, groupPath: string) {
  return (
    view.type === "folder" && (view.path === groupPath || view.path.startsWith(`${groupPath}/`))
  );
}

export function useDriveSidebarModel({
  labels,
  view,
  uploads = null,
  sidebarGroupRoots,
  selectView,
  sidebarDropZoneProps,
  commitMoveToFolder,
}: UseDriveSidebarModelArgs) {
  const primarySidebarItems = useMemo<MenuItemProps[]>(() => {
    const byId = {
      home: {
        label: labels.sidebarHome,
        selected: isMyDriveView(view),
        onClick: () => selectView({ type: "folder", path: "My Drive" }),
        icon: <Files className="size-3.5" />,
        ...sidebarDropZoneProps("My Drive", (ids) => commitMoveToFolder(ids, "My Drive")),
      },
      shared: {
        label: labels.sidebarSharedWithMe,
        selected: view.type === "shared",
        onClick: () => selectView({ type: "shared" }),
        icon: <DriveViewIcon view={{ type: "shared" }} />,
      },
      recent: {
        label: labels.sidebarRecent,
        selected: view.type === "recent",
        onClick: () => selectView({ type: "recent" }),
        icon: <DriveViewIcon view={{ type: "recent" }} />,
      },
      starred: {
        label: labels.sidebarStarred,
        selected: view.type === "starred",
        onClick: () => selectView({ type: "starred" }),
        icon: <DriveViewIcon view={{ type: "starred" }} />,
      },
      // Only while the queue has files or the view is open; failed files keep it.
      uploads:
        (uploads && uploads.count > 0) || view.type === "uploads"
          ? {
              label: labels.sidebarUploads,
              selected: view.type === "uploads",
              onClick: () => selectView({ type: "uploads" }),
              icon: <DriveViewIcon view={{ type: "uploads" }} />,
              badge: uploads && uploads.count > 0 ? <DriveUploadsBadge {...uploads} /> : null,
            }
          : null,
      trash: {
        label: labels.sidebarTrash,
        selected: isTrashView(view),
        onClick: () => selectView({ type: "folder", path: "Trash" }),
        icon: <DriveViewIcon view={{ type: "folder", path: "Trash" }} />,
        ...sidebarDropZoneProps("Trash", (ids) => commitMoveToFolder(ids, "Trash")),
      },
    } satisfies Record<(typeof FILES_BROWSER_SIDEBAR_PRIMARY_ORDER)[number], MenuItemProps | null>;

    return FILES_BROWSER_SIDEBAR_PRIMARY_ORDER.flatMap((id) => byId[id] ?? []);
  }, [labels, commitMoveToFolder, selectView, sidebarDropZoneProps, uploads, view]);

  const groupSidebarItems = useMemo<MenuItemProps[]>(() => {
    const personal: MenuItemProps = {
      label: labels.sidebarMyDrive,
      selected: isMyDriveView(view),
      onClick: () => selectView({ type: "folder", path: "My Drive" }),
      icon: <HardDrive className="size-3.5" />,
      ...sidebarDropZoneProps("My Drive", (ids) => commitMoveToFolder(ids, "My Drive")),
    };
    const groups = sidebarGroupRoots.map((root) => ({
      label: root.label,
      selected: isGroupView(view, root.path),
      onClick: () => selectView({ type: "folder", path: root.path }),
      icon: <DriveViewIcon view={{ type: "folder", path: root.path }} />,
      ...sidebarDropZoneProps(root.path, (ids) => commitMoveToFolder(ids, root.path)),
    }));
    return [personal, ...groups];
  }, [
    commitMoveToFolder,
    labels.sidebarMyDrive,
    selectView,
    sidebarDropZoneProps,
    sidebarGroupRoots,
    view,
  ]);

  return { primarySidebarItems, groupSidebarItems };
}
