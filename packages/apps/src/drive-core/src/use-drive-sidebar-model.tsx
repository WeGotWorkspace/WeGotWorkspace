import { useMemo } from "react";
import { Files, HardDrive } from "lucide-react";
import { DriveViewIcon } from "@/drive-core/src/drive-view-icons";
import { FILES_BROWSER_SIDEBAR_PRIMARY_ORDER } from "@/drive-core/src/files-browser-sidebar";
import type { ViewKey } from "@/drive-core/src/drive-models";
import type { DriveUILabels } from "@/drive-core/src/drive-labels";
import type { MenuItemProps } from "@/menu-item/src/menu-item";

type UseDriveSidebarModelArgs = {
  labels: DriveUILabels;
  view: ViewKey;
  sidebarGroupPaths: string[];
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
  sidebarGroupPaths,
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
      trash: {
        label: labels.sidebarTrash,
        selected: isTrashView(view),
        onClick: () => selectView({ type: "folder", path: "Trash" }),
        icon: <DriveViewIcon view={{ type: "folder", path: "Trash" }} />,
        ...sidebarDropZoneProps("Trash", (ids) => commitMoveToFolder(ids, "Trash")),
      },
    } satisfies Record<(typeof FILES_BROWSER_SIDEBAR_PRIMARY_ORDER)[number], MenuItemProps>;

    return FILES_BROWSER_SIDEBAR_PRIMARY_ORDER.map((id) => byId[id]);
  }, [labels, commitMoveToFolder, selectView, sidebarDropZoneProps, view]);

  const groupSidebarItems = useMemo<MenuItemProps[]>(() => {
    const personal: MenuItemProps = {
      label: labels.sidebarPersonalDrive,
      selected: isMyDriveView(view),
      onClick: () => selectView({ type: "folder", path: "My Drive" }),
      icon: <HardDrive className="size-3.5" />,
      ...sidebarDropZoneProps("My Drive", (ids) => commitMoveToFolder(ids, "My Drive")),
    };
    const groups = sidebarGroupPaths.map((groupPath) => ({
      label: groupPath.split("/").pop() ?? groupPath,
      selected: isGroupView(view, groupPath),
      onClick: () => selectView({ type: "folder", path: groupPath }),
      icon: <DriveViewIcon view={{ type: "folder", path: groupPath }} />,
      ...sidebarDropZoneProps(groupPath, (ids) => commitMoveToFolder(ids, groupPath)),
    }));
    return [personal, ...groups];
  }, [
    commitMoveToFolder,
    labels.sidebarPersonalDrive,
    selectView,
    sidebarDropZoneProps,
    sidebarGroupPaths,
    view,
  ]);

  return { primarySidebarItems, groupSidebarItems };
}
