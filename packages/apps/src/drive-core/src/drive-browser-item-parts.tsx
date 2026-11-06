import type { MenuItemProps } from "@/menu-item/src/menu-item";

// Pieces shared by the grid tiles and the list rows of `drive-browser.tsx`.

export type FolderDropZoneProps = Pick<
  MenuItemProps,
  "isDropTarget" | "onDragEnter" | "onDragOver" | "onDragLeave" | "onDrop"
>;

export type ItemDragHandlers = {
  onDragStart: (e: React.DragEvent) => void;
  onDragEnd: () => void;
};
