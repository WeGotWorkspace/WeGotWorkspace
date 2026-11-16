import type { ReactElement, ReactNode } from "react";
import {
  WorkspaceSwipeList,
  type WorkspaceSwipeListProps,
} from "@/workspace-swipe-list/src/workspace-swipe-list";
import {
  useWorkspaceListRows,
  type WorkspaceListRowsOptions,
} from "@/workspace-list/src/use-workspace-list-rows";

export type WorkspaceListProps<T> = Omit<WorkspaceSwipeListProps, "children"> &
  Omit<
    WorkspaceListRowsOptions<T>,
    "renderSpacer" | "animateReorder" | "windowAfter" | "keyOfItemId"
  > & {
    className?: string;
  };

/**
 * The suite's one list (#1641 step d). An app binds to it with its items in
 * display order and its row; the list memoizes nothing itself but mounts only the
 * rows near the viewport once there are more than 80, keeps the active, focused
 * and dragged rows mounted, and runs the reorder animation. Selection, keyboard,
 * swipe and drag events are `WorkspaceSwipeList`'s, unchanged.
 */
export function WorkspaceList<T>({
  items,
  getKey,
  renderItem,
  estimateSize,
  isHeader,
  renderSection,
  revealActive,
  pinnedKeys,
  className,
  activeId = "",
  ...swipeListProps
}: WorkspaceListProps<T>): ReactElement {
  const { attachList, rows, dataAttributes } = useWorkspaceListRows({
    items,
    getKey,
    renderItem,
    estimateSize,
    isHeader,
    renderSection,
    revealActive,
    activeId,
    pinnedKeys,
  });
  return (
    <div ref={attachList} className={className} {...dataAttributes}>
      <WorkspaceSwipeList activeId={activeId} {...swipeListProps}>
        {rows as ReactNode}
      </WorkspaceSwipeList>
    </div>
  );
}
