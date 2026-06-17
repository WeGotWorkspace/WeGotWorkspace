import { useEffect } from "react";

type UseSpreadsheetKeyboardShortcutsArgs = {
  undo: () => boolean;
  redo: () => boolean;
  /** When true, the source pane is visible and may own native text undo. */
  viewSource: boolean;
};

function shouldUseSpreadsheetUndo(event: KeyboardEvent, viewSource: boolean) {
  const target = event.target as HTMLElement | null;
  if (!target) return true;

  if (
    viewSource &&
    target instanceof HTMLTextAreaElement &&
    target.closest(".spreadsheet-workspace__source")
  ) {
    return false;
  }

  if (target.closest('[role="dialog"]')) return false;

  return true;
}

/** Workbook-level undo/redo shortcuts for the spreadsheet workspace. */
export function useSpreadsheetKeyboardShortcuts({
  undo,
  redo,
  viewSource,
}: UseSpreadsheetKeyboardShortcutsArgs) {
  useEffect(() => {
    const isMac =
      typeof navigator !== "undefined" && /Mac|iPhone|iPad|iPod/.test(navigator.platform);

    const handler = (event: KeyboardEvent) => {
      if (!shouldUseSpreadsheetUndo(event, viewSource)) return;

      const mod = isMac ? event.metaKey : event.ctrlKey;
      if (!mod || event.altKey) return;

      const key = event.key.toLowerCase();
      const isUndo = key === "z" && !event.shiftKey;
      const isRedo = (key === "z" && event.shiftKey) || (key === "y" && !event.shiftKey);
      if (!isUndo && !isRedo) return;

      const handled = isUndo ? undo() : redo();
      if (handled) event.preventDefault();
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [redo, undo, viewSource]);
}
