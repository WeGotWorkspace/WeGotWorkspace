import { useEffect } from "react";

/**
 * Delete (Windows) or Backspace (Mac) asks to delete the selection, outside
 * text fields and only where the structure can change.
 */
export function useDriveDeleteShortcut({
  selectedIds,
  inTrashView,
  structureEnabled,
  requestDelete,
}: {
  selectedIds: string[];
  inTrashView: boolean;
  structureEnabled: boolean;
  requestDelete: (request: { ids: string[]; permanent: boolean }) => void;
}): void {
  useEffect(() => {
    const isMac =
      typeof navigator !== "undefined" && /Mac|iPhone|iPad|iPod/.test(navigator.platform);
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const inField =
        !!target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));
      if (inField || !structureEnabled) return;
      const macDelete = isMac && (e.key === "Backspace" || (e.metaKey && e.key === "Backspace"));
      const winDelete = !isMac && e.key === "Delete";
      if ((macDelete || winDelete) && selectedIds.length > 0) {
        e.preventDefault();
        requestDelete({ ids: selectedIds, permanent: inTrashView });
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [selectedIds, inTrashView, structureEnabled, requestDelete]);
}
