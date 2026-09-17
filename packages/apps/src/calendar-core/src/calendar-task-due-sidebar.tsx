import { Eye } from "lucide-react";
import {
  CollectionSidebarMark,
  CollectionSidebarRow,
} from "@/collection-sidebar/src/collection-sidebar-row";
import { partitionOwnedAndShared } from "@/collection-sidebar/src/collection-sidebar-partition";
import {
  sortSidebarTaskLists,
  type TaskListSidebarEntry,
} from "@/tasks-core/src/use-tasks-sidebar-model";
import { canWriteTaskList, taskListDotColor } from "@/tasks-core/src/tasks-task-utils";
import type { TaskList } from "@/tasks-core/src/tasks-types";

export type CalendarTaskDueSidebarLists = {
  ownedLists: TaskListSidebarEntry[];
  sharedLists: TaskListSidebarEntry[];
};

export function partitionCalendarTaskDueSidebarLists(
  taskLists: readonly TaskList[],
): CalendarTaskDueSidebarLists {
  const partitioned = partitionOwnedAndShared(taskLists);
  return {
    ownedLists: sortSidebarTaskLists(partitioned.owned),
    sharedLists: sortSidebarTaskLists(partitioned.shared),
  };
}

export function CalendarTaskDueSidebarRows({
  lists,
  hiddenListIds,
  viewOnlyLabel,
  onToggleVisibility,
}: {
  lists: readonly TaskListSidebarEntry[];
  hiddenListIds: ReadonlySet<string>;
  viewOnlyLabel: string;
  onToggleVisibility: (listId: string) => void;
}) {
  return (
    <>
      {lists.map((list) => {
        const viewOnly = !canWriteTaskList(list);
        return (
          <CollectionSidebarRow
            key={list.id}
            blockName="calendar-sidebar-row"
            name={list.name}
            color={taskListDotColor(list)}
            selected={false}
            visible={!hiddenListIds.has(list.id)}
            onToggleVisibility={() => onToggleVisibility(list.id)}
            badges={
              viewOnly ? (
                <CollectionSidebarMark
                  label={viewOnlyLabel}
                  className="calendar-sidebar-row__readonly"
                >
                  <Eye className="size-3.5" aria-hidden />
                </CollectionSidebarMark>
              ) : null
            }
          />
        );
      })}
    </>
  );
}
