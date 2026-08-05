import { useMemo } from "react";
import { DriveViewIcon } from "@/drive-core/src/drive-view-icons";
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
  const primarySidebarItems = useMemo<MenuItemProps[]>(
    () => [
      {
        label: labels.sidebarMyDrive,
        selected: isMyDriveView(view),
        onClick: () => selectView({ type: "folder", path: "My Drive" }),
        icon: <DriveViewIcon view={{ type: "folder", path: "My Drive" }} />,
        ...sidebarDropZoneProps("My Drive", (ids) => commitMoveToFolder(ids, "My Drive")),
      },
      {
        label: labels.sidebarSharedWithMe,
        selected: view.type === "shared",
        onClick: () => selectView({ type: "shared" }),
        icon: <DriveViewIcon view={{ type: "shared" }} />,
      },
      {
        label: labels.sidebarRecent,
        selected: view.type === "recent",
        onClick: () => selectView({ type: "recent" }),
        icon: <DriveViewIcon view={{ type: "recent" }} />,
      },
      {
        label: labels.sidebarStarred,
        selected: view.type === "starred",
        onClick: () => selectView({ type: "starred" }),
        icon: <DriveViewIcon view={{ type: "starred" }} />,
      },
      {
        label: labels.sidebarTrash,
        selected: isTrashView(view),
        onClick: () => selectView({ type: "folder", path: "Trash" }),
        icon: <DriveViewIcon view={{ type: "folder", path: "Trash" }} />,
        ...sidebarDropZoneProps("Trash", (ids) => commitMoveToFolder(ids, "Trash")),
      },
    ],
    [labels, commitMoveToFolder, selectView, sidebarDropZoneProps, view],
  );

  const groupSidebarItems = useMemo<MenuItemProps[]>(
    () =>
      sidebarGroupPaths.map((groupPath) => ({
        label: groupPath.split("/").pop() ?? groupPath,
        selected: isGroupView(view, groupPath),
        onClick: () => selectView({ type: "folder", path: groupPath }),
        icon: <DriveViewIcon view={{ type: "folder", path: groupPath }} />,
        ...sidebarDropZoneProps(groupPath, (ids) => commitMoveToFolder(ids, groupPath)),
      })),
    [commitMoveToFolder, selectView, sidebarDropZoneProps, sidebarGroupPaths, view],
  );

  return { primarySidebarItems, groupSidebarItems };
}
