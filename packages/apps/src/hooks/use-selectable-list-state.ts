import { startTransition, useCallback, useState } from "react";
import { COLLECTION_DETAIL_OVERLAY_MEDIA_QUERY } from "@/workspace-app/src/collection-detail-breakpoint";

type UseSelectableListStateOptions = {
  initialId?: string;
  visibleIds: string[];
  onPrimarySelect?: (id: string) => void;
};

/**
 * Overlay viewports run `openMobileDetail` inside `startViewTransition` + `flushSync`.
 * Deferring that with `startTransition` drops the note id / URL update and leaves
 * the empty detail pane on screen with no back control.
 */
function runPrimarySelect(select: () => void): void {
  const overlay = window.matchMedia?.(COLLECTION_DETAIL_OVERLAY_MEDIA_QUERY)?.matches;
  if (overlay) {
    select();
    return;
  }
  startTransition(select);
}

export function useSelectableListState({
  initialId,
  visibleIds,
  onPrimarySelect,
}: UseSelectableListStateOptions) {
  const [selectedIds, setSelectedIds] = useState<string[]>(initialId ? [initialId] : []);
  // The range a shift-click or Shift+Arrow grows: the anchor (last plain or Cmd
  // click) and its moving end (the last shift target).
  const [lastClickedId, setLastClickedId] = useState<string>(initialId ?? "");
  const [rangeEndId, setRangeEndId] = useState<string>(initialId ?? "");

  const setSelectionRange = useCallback((anchorId: string, endId: string) => {
    setLastClickedId(anchorId);
    setRangeEndId(endId);
  }, []);
  const [selectionMode, setSelectionMode] = useState(false);

  const handleSelect = useCallback(
    (id: string, e: React.MouseEvent) => {
      // Shift-click always selects the range from the anchor, also in selection mode
      // (Shift+Arrow turns that on); only a plain or Cmd-click toggles one row there.
      if (e.shiftKey) {
        const a = visibleIds.indexOf(lastClickedId);
        const b = visibleIds.indexOf(id);
        if (a === -1 || b === -1) {
          setSelectedIds([id]);
          setSelectionRange(id, id);
        } else {
          const [start, end] = a < b ? [a, b] : [b, a];
          const range = visibleIds.slice(start, end + 1);
          // In selection mode the range replaces the previous anchor-to-end range and
          // keeps rows picked outside it, like Shift+Arrow.
          if (selectionMode) {
            const endIndex = visibleIds.indexOf(rangeEndId);
            const previous = new Set(
              endIndex === -1
                ? [lastClickedId]
                : visibleIds.slice(Math.min(a, endIndex), Math.max(a, endIndex) + 1),
            );
            const kept = new Set(selectedIds.filter((x) => !previous.has(x)));
            setSelectedIds(visibleIds.filter((x) => range.includes(x) || kept.has(x)));
          } else {
            setSelectedIds(range);
          }
          // The anchor stays; the clicked row is the end Shift+Arrow moves on from.
          setRangeEndId(id);
        }
        return;
      }

      if (selectionMode) {
        const next = selectedIds.includes(id)
          ? selectedIds.filter((x) => x !== id)
          : [...selectedIds, id];
        setSelectedIds(next);
        setSelectionRange(id, id);
        if (next.length === 1) {
          runPrimarySelect(() => {
            onPrimarySelect?.(next[0]!);
          });
        }
        return;
      }

      if (e.metaKey || e.ctrlKey) {
        const next = selectedIds.includes(id)
          ? selectedIds.filter((x) => x !== id)
          : [...selectedIds, id];
        setSelectedIds(next);
        setSelectionRange(id, id);
        // Single leftover selection must drive the open/active row — otherwise
        // isActive and isSelected highlight two different rows in single-select UI.
        if (next.length === 1) {
          runPrimarySelect(() => {
            onPrimarySelect?.(next[0]!);
          });
        }
        return;
      }

      setSelectedIds([id]);
      setSelectionRange(id, id);
      runPrimarySelect(() => {
        onPrimarySelect?.(id);
      });
    },
    [
      lastClickedId,
      onPrimarySelect,
      rangeEndId,
      selectedIds,
      selectionMode,
      setSelectionRange,
      visibleIds,
    ],
  );

  const enterSelectionFor = useCallback((id: string) => {
    setSelectionMode(true);
    setSelectedIds((prev) => (prev.includes(id) ? prev : [...prev, id]));
  }, []);

  const exitSelection = useCallback((activeId?: string) => {
    setSelectionMode(false);
    setSelectedIds(activeId ? [activeId] : []);
  }, []);

  const clearSelection = useCallback(() => {
    setSelectionMode(false);
    setSelectedIds([]);
  }, []);

  const selectSingle = useCallback(
    (id: string) => {
      setSelectedIds([id]);
      setSelectionRange(id, id);
    },
    [setSelectionRange],
  );

  return {
    selectedIds,
    setSelectedIds,
    selectionMode,
    setSelectionMode,
    handleSelect,
    enterSelectionFor,
    exitSelection,
    clearSelection,
    selectSingle,
    selectionAnchorId: lastClickedId,
    selectionEndId: rangeEndId,
    setSelectionRange,
  };
}
