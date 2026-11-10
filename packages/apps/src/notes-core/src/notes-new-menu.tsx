import { BookPlus, Upload } from "lucide-react";
import type { DropdownMenuItemProps } from "@/menu-dropdown/src/dropdown-menu";
import { SidebarSegmentedNewMenu } from "@/sidebar-segmented-new-menu/src/sidebar-segmented-new-menu";
import type { NotesUILabels } from "@/notes-core/src/notes-labels";

export type NotesNewMenuProps = {
  labels: Pick<
    NotesUILabels,
    "newNote" | "newNoteMenu" | "addNotebook" | "importMarkdown" | "importNeedsConnection"
  >;
  onCreateNote: () => void;
  onCreateNotebook?: () => void;
  /** Opens the Markdown file picker (#1623). Absent hides the item. */
  onImportMarkdown?: () => void;
  /** Import needs the server: the item stays visible but disabled with a reason. */
  importOffline?: boolean;
  disabled?: boolean;
};

export function NotesNewMenu({
  labels,
  onCreateNote,
  onCreateNotebook,
  onImportMarkdown,
  importOffline = false,
  disabled,
}: NotesNewMenuProps) {
  const items: DropdownMenuItemProps[] = [];
  if (onCreateNotebook) {
    items.push({
      id: "create-notebook",
      label: labels.addNotebook,
      icon: <BookPlus aria-hidden />,
      onClick: onCreateNotebook,
    });
  }
  if (onImportMarkdown) {
    items.push({
      id: "import-markdown",
      label: labels.importMarkdown,
      icon: <Upload aria-hidden />,
      onClick: onImportMarkdown,
      disabled: importOffline,
      description: importOffline ? labels.importNeedsConnection : undefined,
    });
  }

  return (
    <SidebarSegmentedNewMenu
      mainLabel={labels.newNote}
      menuLabel={labels.newNoteMenu}
      onMainAction={onCreateNote}
      mainDisabled={disabled}
      items={items}
    />
  );
}
