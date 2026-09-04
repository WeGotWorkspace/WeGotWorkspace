import type { Dispatch, ReactNode, SetStateAction } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";
import type { IdentifiableItem } from "@/hooks/collection-controller-utils";
import type { ListDropZoneProps } from "@/hooks/use-sidebar-list-drag";
import type { DeferredApiWriteArgs } from "@/hooks/use-queued-mutation";

export type ItemDragHandlers = {
  onDragStart: (e: React.DragEvent) => void;
  onDragEnd: () => void;
};

export type WorkspaceActionButton = {
  label: string;
  icon: ReactNode;
  onClick: () => void;
  active?: boolean;
};

export type UseWorkspaceListControllerArgs<TItem extends IdentifiableItem> = {
  items: TItem[];
  setItems: Dispatch<SetStateAction<TItem[]>>;
  visibleIds: string[];
  activeId: string;
  setActiveId: (id: string) => void;
  initialId?: string;
  onPrimarySelect?: (id: string) => void;
  onNavigateToId?: (id: string) => void;
  onMutationError: () => void;
  queueDelayMs?: number;
};

export type WorkspaceListControllerResult<TItem> = {
  selectedIds: string[];
  setSelectedIds: Dispatch<SetStateAction<string[]>>;
  selectionMode: boolean;
  setSelectionMode: Dispatch<SetStateAction<boolean>>;
  handleSelect: (id: string, e: ReactMouseEvent) => void;
  enterSelectionFor: (id: string) => void;
  exitSelection: (activeId?: string) => void;
  selectSingle: (id: string) => void;
  isItemDragging: (id: string) => boolean;
  itemDragHandlers: (id: string) => ItemDragHandlers;
  sidebarDropZoneProps: (
    targetKey: string,
    onCommit: (ids: string[]) => void,
    canAccept?: (ids: string[]) => boolean,
  ) => ListDropZoneProps;
  beginOptimisticUpdate: ({ ids, updater }: { ids: string[]; updater: (item: TItem) => TItem }) => {
    snapshotById: Map<string, TItem>;
    affectedItems: TItem[];
    rollback: () => void;
  };
  queueMutation: (args: DeferredApiWriteArgs) => void;
  undoLatest: () => boolean;
  navigateListByKeyboard: (direction: -1 | 1, extendSelection: boolean) => void;
};
