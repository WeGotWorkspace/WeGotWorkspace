import { Check } from "lucide-react";
import type { MenuItemProps } from "@/menu-item/src/menu-item";
import { cn } from "@/lib/utils";

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
      <span
        className={cn(
          "drive-selection-checkbox",
          isSelected && "drive-selection-checkbox--selected",
        )}
      >
        {isSelected ? (
          <Check className="drive-selection-checkbox__icon" strokeWidth={2.75} />
        ) : null}
      </span>
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
