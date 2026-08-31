import { useMemo } from "react";
import { CheckCircle2 } from "lucide-react";
import { FloatingActionBar } from "@/floating-action-bar/src/floating-action-bar";
import { useEntityBatchActions } from "@/hooks/use-entity-batch-actions";
import { useListKeyboardNavigation } from "@/hooks/use-list-keyboard-navigation";
import { useQueuedMutation } from "@/hooks/use-queued-mutation";
import { useSelectableListState } from "@/hooks/use-selectable-list-state";
import { useSidebarListDrag } from "@/hooks/use-sidebar-list-drag";
import type { IdentifiableItem } from "@/hooks/collection-controller-utils";
import type {
  UseWorkspaceListControllerArgs,
  WorkspaceActionButton,
  WorkspaceListControllerResult,
} from "./workspace-list-controller-types";

export function useWorkspaceListController<TItem extends IdentifiableItem>({
  items,
  setItems,
  visibleIds,
  activeId,
  setActiveId,
  initialId,
  onPrimarySelect,
  onNavigateToId,
  onMutationError,
  queueDelayMs = 2500,
}: UseWorkspaceListControllerArgs<TItem>): WorkspaceListControllerResult<TItem> {
  const {
    selectedIds,
    setSelectedIds,
    selectionMode,
    setSelectionMode,
    handleSelect,
    enterSelectionFor,
    exitSelection,
    selectSingle,
  } = useSelectableListState({
    initialId,
    visibleIds,
    onPrimarySelect,
  });

  const { isItemDragging, itemDragHandlers, sidebarDropZoneProps } =
    useSidebarListDrag(selectedIds);
  const { beginOptimisticUpdate } = useEntityBatchActions<TItem>({
    items,
    setItems,
    visibleIds,
    activeId,
    setActiveId,
  });
  const { queueMutation, undoLatest } = useQueuedMutation({
    delayMs: queueDelayMs,
    onMutationError,
  });
  const { navigateListByKeyboard } = useListKeyboardNavigation({
    visibleIds,
    activeId,
    selectedIds,
    setActiveId,
    setSelectionMode,
    setSelectedIds,
    onNavigateToId,
  });

  return {
    selectedIds,
    setSelectedIds,
    selectionMode,
    setSelectionMode,
    handleSelect,
    enterSelectionFor,
    exitSelection,
    selectSingle,
    isItemDragging,
    itemDragHandlers,
    sidebarDropZoneProps,
    beginOptimisticUpdate,
    queueMutation,
    undoLatest,
    navigateListByKeyboard,
  };
}

export function useWorkspaceSelectionPresentation({
  selectedIds,
  selectionMode,
  activeId,
  exitSelection,
  actionButtons,
  doneLabel,
  floatingClassName = "md:hidden",
}: {
  selectedIds: string[];
  selectionMode: boolean;
  activeId: string;
  exitSelection: (activeId?: string) => void;
  actionButtons: WorkspaceActionButton[];
  doneLabel: string;
  floatingClassName?: string;
}) {
  const selectionBarButtons = useMemo<WorkspaceActionButton[]>(
    () => [
      ...actionButtons,
      {
        label: doneLabel,
        icon: <CheckCircle2 className="size-4" />,
        onClick: () => exitSelection(activeId),
      },
    ],
    [actionButtons, doneLabel, exitSelection, activeId],
  );

  const selectionBar =
    selectionMode || selectedIds.length > 1 ? (
      <FloatingActionBar
        items={selectedIds.length}
        buttons={selectionBarButtons}
        className={floatingClassName}
      />
    ) : null;

  return {
    selectionBarButtons,
    selectionBar,
    multiSelectionActions: selectionBarButtons,
  };
}
