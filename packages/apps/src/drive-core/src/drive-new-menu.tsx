import { FolderUp, Upload, ScrollText } from "lucide-react";
import type { DropdownMenuItemProps } from "@/menu-dropdown/src/dropdown-menu";
import { SidebarSegmentedNewMenu } from "@/sidebar-segmented-new-menu/src/sidebar-segmented-new-menu";
import type { DriveUILabels } from "@/drive-core/src/drive-labels";

export type DriveNewMenuProps = {
  labels: Pick<
    DriveUILabels,
    "newFolder" | "newButtonMenu" | "uploadFiles" | "uploadFolder" | "newMarkdown"
  >;
  onCreateFolder: () => void;
  /** Omitted when the session cannot upload (guests). */
  onUploadFiles?: () => void;
  /** Omitted without the upload queue: folders upload through it only (#1620). */
  onUploadFolder?: () => void;
  onCreateMarkdown?: () => void;
};

export function DriveNewMenu({
  labels,
  onCreateFolder,
  onUploadFiles,
  onUploadFolder,
  onCreateMarkdown,
}: DriveNewMenuProps) {
  const items: DropdownMenuItemProps[] = [];
  if (onUploadFiles) {
    items.push({
      id: "upload-files",
      label: labels.uploadFiles,
      icon: <Upload aria-hidden />,
      onClick: onUploadFiles,
    });
  }
  if (onUploadFolder) {
    items.push({
      id: "upload-folder",
      label: labels.uploadFolder,
      icon: <FolderUp aria-hidden />,
      onClick: onUploadFolder,
    });
  }
  if (onCreateMarkdown) {
    items.push({
      id: "create-markdown",
      label: labels.newMarkdown,
      icon: <ScrollText aria-hidden />,
      onClick: onCreateMarkdown,
    });
  }

  return (
    <SidebarSegmentedNewMenu
      mainLabel={labels.newFolder}
      menuLabel={labels.newButtonMenu}
      onMainAction={onCreateFolder}
      items={items}
    />
  );
}
