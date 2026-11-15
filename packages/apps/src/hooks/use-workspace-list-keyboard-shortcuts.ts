import { useEffect, type RefObject } from "react";
import { listItemIdOf, refocusListAfterNavigation } from "@/hooks/list-item-focus";

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
  /**
   * Enter: open the current item (a folder, a file). Gets the id of the list item that
   * has keyboard focus, if any (it wins over the selection).
   */
  onOpenActive?: (focusedId: string | null) => void;
  /** F2: rename the current item (same focused id as Enter). */
  onRenameActive?: (focusedId: string | null) => void;
  /** Alt+↑: go up one folder. */
  onNavigateUp?: () => void;
};

/**
 * A control of its own (a button, a link, a menu row) keeps Enter. A list row or
 * tile marks its focus target with `data-list-item-focus`: Enter there opens the item.
 */
function ownsEnter(target: HTMLElement | null): boolean {
  if (!target || typeof target.closest !== "function") return false;
  if (target.closest("[data-list-item-focus]") === target) return false;
  return !!target.closest(
    'button, a[href], [role="button"], [role="link"], [role="menuitem"], [role="tab"], [role="switch"], [role="checkbox"], [role="option"]',
  );
}

/**
 * The suite's one keymap for lists (Drive, Docs, Notes, Tasks, Contacts…), the same
 * on every platform:
 * - ⌘/Ctrl+K or / focuses search;
 * - ↑/↓ move the selection, Shift+↑/↓ grow it;
 * - Enter opens the current item, F2 renames it, Alt+↑ goes up one folder;
 * - Delete (Backspace on a Mac) asks to delete the selection.
 * Nothing here runs while focus is in a field or a dialog.
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
  onOpenActive,
  onRenameActive,
  onNavigateUp,
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
      // A dialog over the list owns the keyboard (focus is trapped inside it).
      if (target?.closest?.('[role="dialog"], [role="alertdialog"]')) return;
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
      // A dropdown, menu or combobox (a detail field, closed or open) owns its arrows:
      // they open it or move between its options, never to another item in the list.
      const inPicker =
        e.defaultPrevented ||
        (!!target &&
          typeof target.closest === "function" &&
          !!target.closest('[role="combobox"], [role="listbox"], [role="menu"]'));
      if (inPicker) return;
      if (e.code === "Space") {
        spaceHeld = true;
      }
      if (e.key === "ArrowUp" && e.altKey && !e.shiftKey && !e.metaKey && !e.ctrlKey) {
        if (onNavigateUp) {
          e.preventDefault();
          onNavigateUp();
          if (listItemIdOf(target)) refocusListAfterNavigation();
        }
        return;
      }
      const plainKey = !e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey;
      const focusedId = listItemIdOf(target);
      if (e.key === "Enter" && plainKey && !e.repeat && onOpenActive) {
        if (inContentEditable || ownsEnter(target)) return;
        e.preventDefault();
        onOpenActive(focusedId);
        if (focusedId) refocusListAfterNavigation();
        return;
      }
      if (e.key === "F2" && plainKey && onRenameActive) {
        e.preventDefault();
        onRenameActive(focusedId);
        return;
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
    onOpenActive,
    onRenameActive,
    onNavigateUp,
  ]);
}
