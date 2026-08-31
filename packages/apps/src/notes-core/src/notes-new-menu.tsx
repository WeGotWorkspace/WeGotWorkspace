import { BookPlus } from "lucide-react";
import type { DropdownMenuItemProps } from "@/menu-dropdown/src/dropdown-menu";
import { SidebarSegmentedNewMenu } from "@/sidebar-segmented-new-menu/src/sidebar-segmented-new-menu";
import type { NotesUILabels } from "@/notes-core/src/notes-labels";

export type NotesNewMenuProps = {
  labels: Pick<NotesUILabels, "newNote" | "newNoteMenu" | "addNotebook">;
  onCreateNote: () => void;
  onCreateNotebook?: () => void;
  disabled?: boolean;
};

export function NotesNewMenu({
  labels,
  onCreateNote,
  onCreateNotebook,
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
