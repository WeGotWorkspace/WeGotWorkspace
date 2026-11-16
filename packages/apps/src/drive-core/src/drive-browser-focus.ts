import type { DriveFile } from "@/lib/files/drive-models";

/**
 * Multi-select intent: selection mode (long-press, right-click) or more than one
 * item (Cmd/Shift-click). A plain click selects one item and shows no bar.
 */
export function multiSelectAttr(selectionMode: boolean, selectedIds: string[]) {
  return selectionMode || selectedIds.length > 1 ? "true" : "false";
}

/**
 * The one item of a list or grid that Tab reaches (roving focus): the current item,
 * else the first selected, else the first. ↑/↓ then move focus within the list.
 */
export function listFocusId(
  items: DriveFile[],
  activeId: string | null | undefined,
  selectedIds: string[],
): string | undefined {
  const visible = (id: string | null | undefined): id is string =>
    !!id && items.some((file) => file.id === id);
  if (visible(activeId)) return activeId;
  return selectedIds.find(visible) ?? items[0]?.id;
}
