import type { MouseEvent } from "react";
import type { DriveFile } from "@/lib/files/drive-models";
import type { ItemDragHandlers } from "@/drive-core/src/drive-browser-item-parts";
import { useLongPress } from "@/drive-core/src/use-drive-long-press";

/**
 * What a grid tile (file or folder) does with the pointer: right click and long press open
 * its menu, it drags, and an overlay button is the click target, so the actions menu is
 * not nested inside a button (axe nested-interactive). The picker's tiles only click.
 */
export function useDriveTileTarget({
  file,
  pickerChrome,
  isTouch,
  isFocusTarget,
  selectionMode,
  itemDragHandlers,
  onSelect,
  onOpen,
  onLongPress,
}: {
  file: DriveFile;
  pickerChrome: boolean;
  isTouch: boolean;
  isFocusTarget: boolean;
  selectionMode: boolean;
  itemDragHandlers: ItemDragHandlers;
  onSelect: (event: MouseEvent) => void;
  onOpen: () => void;
  onLongPress: () => void;
}) {
  const lp = useLongPress(onLongPress);
  const rootProps = {
    "data-list-item-id": file.id,
    onContextMenu: pickerChrome
      ? undefined
      : (event: MouseEvent) => {
          if (isTouch) return;
          event.preventDefault();
          onLongPress();
        },
    draggable: !pickerChrome && !isTouch,
    onDragStart: pickerChrome ? undefined : itemDragHandlers.onDragStart,
    onDragEnd: pickerChrome ? undefined : itemDragHandlers.onDragEnd,
  };
  const hit = (
    <button
      type="button"
      aria-label={file.title}
      className="drive-tile__hit"
      tabIndex={isFocusTarget ? 0 : -1}
      data-list-item-focus=""
      onClick={(event) => {
        if (lp.fired.current) return;
        onSelect(event);
      }}
      onDoubleClick={selectionMode ? undefined : onOpen}
      onTouchStart={pickerChrome ? undefined : lp.start}
      onTouchEnd={pickerChrome ? undefined : lp.cancel}
      onTouchMove={pickerChrome ? undefined : lp.cancel}
    />
  );
  return { rootProps, hit };
}
