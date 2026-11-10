import { Eye } from "lucide-react";
import {
  CollectionSidebarMark,
  CollectionSidebarRow,
} from "@/collection-sidebar/src/collection-sidebar-row";
import { partitionOwnedAndShared } from "@/collection-sidebar/src/collection-sidebar-partition";
import { SidebarSection } from "@/sidebar-section/src/sidebar-section";
import {
  sectionToggleAll,
  withIds,
  type SidebarSectionToggleAll,
} from "@/sidebar-section/src/section-toggle-all";
import {
  sortSidebarTaskLists,
  type TaskListSidebarEntry,
} from "@/tasks-core/src/use-tasks-sidebar-model";
import { canWriteTaskList, taskListDotColor } from "@/tasks-core/src/tasks-task-utils";
import type { TaskList } from "@/tasks-core/src/tasks-types";
import type { CalendarUILabels } from "@/calendar-core/src/calendar-labels";
import { useCalendarSectionCollapsed } from "@/calendar-core/src/use-calendar-section-collapsed";

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

/** The Reminders heading's show/hide-all dot over `lists`; other hidden ids are kept. */
function taskListsToggleAll({
  lists,
  hiddenListIds,
  onSetHiddenListIds,
  showLabel,
  hideLabel,
}: {
  lists: readonly TaskListSidebarEntry[];
  hiddenListIds: ReadonlySet<string>;
  onSetHiddenListIds: (next: ReadonlySet<string>) => void;
  showLabel: string;
  hideLabel: string;
}): SidebarSectionToggleAll | undefined {
  const ids = lists.map((list) => list.id);
  return sectionToggleAll({
    ids,
    isOn: (id) => !hiddenListIds.has(id),
    onSetAll: (on) => onSetHiddenListIds(withIds(hiddenListIds, ids, !on)),
    showLabel,
    hideLabel,
  });
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

type RemindersLabels = Pick<
  CalendarUILabels,
  | "tasksSection"
  | "tasksSectionShowAll"
  | "tasksSectionHideAll"
  | "tasksSectionCollapse"
  | "tasksSectionExpand"
  | "sharedTaskListsSection"
  | "viewOnlyCalendarBadge"
>;

/**
 * Reminders (the user's own lists, with a show/hide-all dot and a fold
 * remembered on this device), then Shared reminders. An empty section is left out.
 */
export function CalendarRemindersSidebar({
  lists,
  sharedLists = [],
  hiddenListIds,
  onSetHiddenListIds,
  onToggleVisibility,
  labels,
}: {
  lists: readonly TaskListSidebarEntry[];
  sharedLists?: readonly TaskListSidebarEntry[];
  hiddenListIds: ReadonlySet<string>;
  onSetHiddenListIds: (next: ReadonlySet<string>) => void;
  onToggleVisibility: (listId: string) => void;
  labels: RemindersLabels;
}) {
  const { collapsed, toggleCollapsed } = useCalendarSectionCollapsed("remindersCollapsed");
  const rowProps = {
    hiddenListIds,
    viewOnlyLabel: labels.viewOnlyCalendarBadge,
    onToggleVisibility,
  };
  return (
    <>
      {lists.length > 0 ? (
        <SidebarSection
          title={labels.tasksSection}
          collapsed={collapsed}
          onToggleCollapsed={toggleCollapsed}
          collapseLabel={labels.tasksSectionCollapse}
          expandLabel={labels.tasksSectionExpand}
          toggleAll={taskListsToggleAll({
            lists,
            hiddenListIds,
            onSetHiddenListIds,
            showLabel: labels.tasksSectionShowAll,
            hideLabel: labels.tasksSectionHideAll,
          })}
        >
          <CalendarTaskDueSidebarRows lists={lists} {...rowProps} />
        </SidebarSection>
      ) : null}
      {sharedLists.length > 0 ? (
        <SidebarSection title={labels.sharedTaskListsSection}>
          <CalendarTaskDueSidebarRows lists={sharedLists} {...rowProps} />
        </SidebarSection>
      ) : null}
    </>
  );
}
