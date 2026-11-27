import { useEffect } from "react";

type UseSpreadsheetKeyboardShortcutsArgs = {
  undo: () => boolean;
  redo: () => boolean;
  clearSelection: () => boolean;
  /** When true, the source pane is visible and may own native text undo. */
  viewSource: boolean;
  /** When true, the formula bar owns Delete/Backspace. */
  formulaBarEditing: boolean;
};

function shouldUseSpreadsheetGridShortcuts(
  event: KeyboardEvent,
  viewSource: boolean,
  formulaBarEditing: boolean,
) {
  const target = event.target as HTMLElement | null;
  if (!target) return true;

  if (
    viewSource &&
    target instanceof HTMLTextAreaElement &&
    target.closest(".spreadsheet-workspace__source")
  ) {
    return false;
  }

  if (formulaBarEditing) return false;

  if (target.closest(".spreadsheet-cell-editor")) return false;
  if (document.querySelector(".spreadsheet-cell-editor__input")) return false;

  if (target.closest('[role="dialog"]')) return false;

  return true;
}

/** Workbook-level keyboard shortcuts for the spreadsheet workspace. */
export function useSpreadsheetKeyboardShortcuts({
  undo,
  redo,
  clearSelection,
  viewSource,
  formulaBarEditing,
}: UseSpreadsheetKeyboardShortcutsArgs) {
  useEffect(() => {
    const isMac =
      typeof navigator !== "undefined" && /Mac|iPhone|iPad|iPod/.test(navigator.platform);

    const handler = (event: KeyboardEvent) => {
      if (!shouldUseSpreadsheetGridShortcuts(event, viewSource, formulaBarEditing)) return;

      const mod = isMac ? event.metaKey : event.ctrlKey;
      const key = event.key.toLowerCase();

      if (mod && !event.altKey) {
        const isUndo = key === "z" && !event.shiftKey;
        const isRedo = (key === "z" && event.shiftKey) || (key === "y" && !event.shiftKey);
        if (isUndo || isRedo) {
          const handled = isUndo ? undo() : redo();
          if (handled) event.preventDefault();
        }
        return;
      }

      if (event.altKey || mod) return;

      if (key !== "delete" && key !== "backspace") return;

      const handled = clearSelection();
      if (handled) event.preventDefault();
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [clearSelection, formulaBarEditing, redo, undo, viewSource]);
}
