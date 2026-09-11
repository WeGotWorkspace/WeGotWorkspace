import { Upload, FileText, FileSpreadsheet, Presentation, ScrollText } from "lucide-react";
import type { DropdownMenuItemProps } from "@/menu-dropdown/src/dropdown-menu";
import { SidebarSegmentedNewMenu } from "@/sidebar-segmented-new-menu/src/sidebar-segmented-new-menu";
import type { DriveUILabels } from "@/drive-core/src/drive-labels";

export type DriveBlankKind = "doc" | "sheet" | "slides";

export type DriveNewFileTemplate = {
  id: string;
  label: string;
  kind: DriveBlankKind;
};

export type DriveNewMenuProps = {
  labels: Pick<DriveUILabels, "newFolder" | "newButtonMenu" | "uploadFiles" | "newMarkdown">;
  onCreateFolder: () => void;
  onUploadFiles: () => void;
  onCreateMarkdown?: () => void;
  newFileTemplates?: readonly DriveNewFileTemplate[];
  onCreateTemplate?: (templateId: string) => void;
};

function templateIcon(kind: DriveBlankKind) {
  if (kind === "doc") return <FileText aria-hidden />;
  if (kind === "sheet") return <FileSpreadsheet aria-hidden />;
  return <Presentation aria-hidden />;
}

export function DriveNewMenu({
  labels,
  onCreateFolder,
  onUploadFiles,
  onCreateMarkdown,
  newFileTemplates = [],
  onCreateTemplate,
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
  for (const template of newFileTemplates) {
    items.push({
      id: `template-${template.id}`,
      label: template.label,
      icon: templateIcon(template.kind),
      onClick: () => onCreateTemplate?.(template.id),
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
