import { Upload, ScrollText } from "lucide-react";
import type { DropdownMenuItemProps } from "@/menu-dropdown/src/dropdown-menu";
import { SidebarSegmentedNewMenu } from "@/sidebar-segmented-new-menu/src/sidebar-segmented-new-menu";
import type { DriveUILabels } from "@/drive-core/src/drive-labels";

export type DriveNewMenuProps = {
  labels: Pick<DriveUILabels, "newFolder" | "newButtonMenu" | "uploadFiles" | "newMarkdown">;
  onCreateFolder: () => void;
  onUploadFiles: () => void;
  onCreateMarkdown?: () => void;
};

export function DriveNewMenu({
  labels,
  onCreateFolder,
  onUploadFiles,
  onCreateMarkdown,
}: DriveNewMenuProps) {
  const items: DropdownMenuItemProps[] = [
    {
      id: "upload-files",
      label: labels.uploadFiles,
      icon: <Upload aria-hidden />,
      onClick: onUploadFiles,
    },
  ];
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
