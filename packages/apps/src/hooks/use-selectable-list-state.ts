import { startTransition, useCallback, useState } from "react";

type UseSelectableListStateOptions = {
  initialId?: string;
  visibleIds: string[];
  onPrimarySelect?: (id: string) => void;
};

export function useSelectableListState({
  initialId,
  visibleIds,
  onPrimarySelect,
}: UseSelectableListStateOptions) {
  const [selectedIds, setSelectedIds] = useState<string[]>(initialId ? [initialId] : []);
  const [lastClickedId, setLastClickedId] = useState<string>(initialId ?? "");
  const [selectionMode, setSelectionMode] = useState(false);

  const handleSelect = useCallback(
    (id: string, e: React.MouseEvent) => {
      if (selectionMode) {
        const next = selectedIds.includes(id)
          ? selectedIds.filter((x) => x !== id)
          : [...selectedIds, id];
        setSelectedIds(next);
        setLastClickedId(id);
        if (next.length === 1) {
          startTransition(() => {
            onPrimarySelect?.(next[0]!);
          });
        }
        return;
      }

      if (e.shiftKey) {
        const a = visibleIds.indexOf(lastClickedId);
        const b = visibleIds.indexOf(id);
        if (a === -1 || b === -1) {
          setSelectedIds([id]);
        } else {
          const [start, end] = a < b ? [a, b] : [b, a];
          setSelectedIds(visibleIds.slice(start, end + 1));
        }
        return;
      }

      if (e.metaKey || e.ctrlKey) {
        const next = selectedIds.includes(id)
          ? selectedIds.filter((x) => x !== id)
          : [...selectedIds, id];
        setSelectedIds(next);
        setLastClickedId(id);
        // Single leftover selection must drive the open/active row — otherwise
        // isActive and isSelected highlight two different rows in single-select UI.
        if (next.length === 1) {
          startTransition(() => {
            onPrimarySelect?.(next[0]!);
          });
        }
        return;
      }

      setSelectedIds([id]);
      setLastClickedId(id);
      startTransition(() => {
        onPrimarySelect?.(id);
      });
    },
    [lastClickedId, onPrimarySelect, selectedIds, selectionMode, visibleIds],
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

  const selectSingle = useCallback((id: string) => {
    setSelectedIds([id]);
    setLastClickedId(id);
  }, []);

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
  };
}
