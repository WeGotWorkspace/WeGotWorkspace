import type { MenuItemProps } from "@/menu-item/src/menu-item";
import { cn } from "@/lib/utils";
import { SelectionMark } from "@/selection-mark/src/selection-mark";

// Pieces shared by the grid tiles and the list rows of `drive-browser.tsx`.

export function DriveSelectionCheckbox({
  isSelected,
  className,
}: {
  isSelected: boolean;
  selectionMode?: boolean;
  className?: string;
}) {
  return (
    <span aria-hidden className={cn("drive-selection-checkbox-wrap", className)}>
      <SelectionMark checked={isSelected} />
    </span>
  );
}

export type FolderDropZoneProps = Pick<
  MenuItemProps,
  "isDropTarget" | "onDragEnter" | "onDragOver" | "onDragLeave" | "onDrop"
>;

export type ItemDragHandlers = {
  onDragStart: (e: React.DragEvent) => void;
  onDragEnd: () => void;
};
