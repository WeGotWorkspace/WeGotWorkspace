import { useEffect, type RefObject } from "react";

export type UseWorkspaceListKeyboardShortcutsOptions = {
  searchInputRef: RefObject<HTMLInputElement | null>;
  selectedCount: number;
  selectionMode?: boolean;
  /** When set, list shortcuts still run while focus is inside this detail editor. */
  detailEditorSelector?: string;
  onRequestDeleteSelection: () => void;
  onNavigateList?: (direction: -1 | 1, extendSelection: boolean) => void;
  onUndoQueuedAction?: () => boolean;
  /** When false, arrow/space/delete list shortcuts are suppressed. */
  listNavigationEnabled?: boolean;
};

/**
 * Focus list search (⌘/Ctrl+K or /) and request delete for the current selection
 * when Backspace/Delete is pressed outside editable fields.
 */
export function useWorkspaceListKeyboardShortcuts({
  searchInputRef,
  selectedCount,
  selectionMode = false,
  detailEditorSelector = "[data-workspace-detail-editor]",
  onRequestDeleteSelection,
  onNavigateList,
  onUndoQueuedAction,
  listNavigationEnabled = true,
}: UseWorkspaceListKeyboardShortcutsOptions) {
  useEffect(() => {
    const isMac =
      typeof navigator !== "undefined" && /Mac|iPhone|iPad|iPod/.test(navigator.platform);
    let spaceHeld = false;
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const inFormField = !!target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName);
      const inDetailEditor =
        !!target && typeof target.closest === "function" && !!target.closest(detailEditorSelector);
      const inContentEditable = !!target?.isContentEditable;
      const listShortcutsAllowed =
        !inFormField &&
        (!inContentEditable ||
          (inDetailEditor && selectedCount > 0 && (selectionMode || selectedCount > 1)));

      if ((e.key === "k" && (e.metaKey || e.ctrlKey)) || (listShortcutsAllowed && e.key === "/")) {
        e.preventDefault();
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
        return;
      }

      if (!listShortcutsAllowed) return;
      const keyLower = e.key.toLowerCase();
      const undoPressed =
        keyLower === "z" &&
        !e.shiftKey &&
        !e.altKey &&
        ((isMac && e.metaKey) || (!isMac && e.ctrlKey));
      if (undoPressed && onUndoQueuedAction) {
        const handled = onUndoQueuedAction();
        if (handled) e.preventDefault();
        return;
      }
      if (!listNavigationEnabled) return;
      if (e.code === "Space") {
        spaceHeld = true;
      }
      if ((e.key === "ArrowDown" || e.key === "ArrowUp") && onNavigateList) {
        e.preventDefault();
        const hasModifier = e.shiftKey || e.metaKey || e.ctrlKey || e.altKey;
        const extendSelection = hasModifier || spaceHeld;
        onNavigateList(e.key === "ArrowDown" ? 1 : -1, extendSelection);
        return;
      }
      const macDelete = isMac && (e.key === "Backspace" || (e.metaKey && e.key === "Backspace"));
      const winDelete = !isMac && e.key === "Delete";
      if ((macDelete || winDelete) && selectedCount > 0) {
        e.preventDefault();
        onRequestDeleteSelection();
      }
    };
    const keyupHandler = (e: KeyboardEvent) => {
      if (e.code === "Space") spaceHeld = false;
    };
    window.addEventListener("keydown", handler);
    window.addEventListener("keyup", keyupHandler);
    return () => {
      window.removeEventListener("keydown", handler);
      window.removeEventListener("keyup", keyupHandler);
    };
  }, [
    searchInputRef,
    selectedCount,
    selectionMode,
    detailEditorSelector,
    onRequestDeleteSelection,
    onNavigateList,
    onUndoQueuedAction,
    listNavigationEnabled,
  ]);
}
