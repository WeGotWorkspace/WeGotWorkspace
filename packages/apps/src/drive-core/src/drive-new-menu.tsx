import { Upload, ScrollText } from "lucide-react";
import type { DropdownMenuItemProps } from "@/menu-dropdown/src/dropdown-menu";
import { SidebarSegmentedNewMenu } from "@/sidebar-segmented-new-menu/src/sidebar-segmented-new-menu";
import type { DriveUILabels } from "@/drive-core/src/drive-labels";

export type DriveNewMenuProps = {
  labels: Pick<DriveUILabels, "newFolder" | "newButtonMenu" | "uploadFiles" | "newMarkdown">;
  /** Omitted for a share-link guest, who cannot create folders (#1712). */
  onCreateFolder?: () => void;
  /** Omitted when the session cannot upload (a guest on a view link). */
  onUploadFiles?: () => void;
  onCreateMarkdown?: () => void;
};

export function DriveNewMenu({
  labels,
  onCreateFolder,
  onUploadFiles,
  onCreateMarkdown,
}: DriveNewMenuProps) {
  if (!onCreateFolder) {
    // A guest on a link that allows uploads: uploading is the only action.
    return onUploadFiles ? (
      <SidebarSegmentedNewMenu
        mainLabel={labels.uploadFiles}
        menuLabel={labels.newButtonMenu}
        onMainAction={onUploadFiles}
        icon={<Upload aria-hidden />}
      />
    ) : null;
  }
  const items: DropdownMenuItemProps[] = [];
  if (onUploadFiles) {
    items.push({
      id: "upload-files",
      label: labels.uploadFiles,
      icon: <Upload aria-hidden />,
      onClick: onUploadFiles,
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
