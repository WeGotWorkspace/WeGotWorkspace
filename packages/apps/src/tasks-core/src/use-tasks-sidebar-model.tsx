import { useMemo } from "react";
import {
  Calendar,
  CalendarClock,
  CheckCircle2,
  CircleAlert,
  CircleDot,
  CircleX,
  Clock,
  LayoutList,
} from "lucide-react";
import { partitionOwnedAndShared } from "@/collection-sidebar/src/collection-sidebar-partition";
import type { TasksUILabels } from "@/tasks-core/src/tasks-labels";
import {
  canWriteTaskList,
  defaultTaskListId,
  isInboxTaskList,
} from "@/tasks-core/src/tasks-task-utils";
import {
  PRIORITY_FILTER_SLUGS,
  priorityFilterIcon,
  priorityFilterLabel,
} from "@/tasks-core/src/tasks-priority";

export type TaskListSidebarEntry = {
  id: string;
  name: string;
  role?: string | null;
  color?: string | null;
  isSharee?: boolean;
  isDefault?: boolean;
  myRights?: { mayWriteAll?: boolean; mayShare?: boolean } | null;
};

type UseTasksSidebarModelArgs = {
  labels: TasksUILabels;
  view: string;
  taskLists: TaskListSidebarEntry[];
  selectView: (view: string) => void;
};

export function useTasksSidebarModel({
  labels,
  view,
  taskLists,
  selectView,
}: UseTasksSidebarModelArgs) {
  const ownInboxId = useMemo(() => defaultTaskListId(taskLists), [taskLists]);

  const { owned: ownedLists, shared: sharedLists } = useMemo(
    () => partitionOwnedAndShared(taskLists),
    [taskLists],
  );

  const topSidebarItems = useMemo(
    () => [
      {
        label: labels.stateAll,
        icon: <LayoutList className="size-3.5" />,
        selected: view === "state:all",
        onClick: () => selectView("state:all"),
      },
      {
        label: labels.stateToday,
        icon: <Calendar className="size-3.5" />,
        selected: view === "state:today",
        onClick: () => selectView("state:today"),
      },
      {
        label: labels.stateUpcoming,
        icon: <CalendarClock className="size-3.5" />,
        selected: view === "state:upcoming",
        onClick: () => selectView("state:upcoming"),
      },
      {
        label: labels.stateOverdue,
        icon: <CircleAlert className="size-3.5" />,
        selected: view === "state:overdue",
        onClick: () => selectView("state:overdue"),
      },
    ],
    [labels, selectView, view],
  );

  const statusSidebarItems = useMemo(
    () => [
      {
        label: labels.stateNeedsAction,
        icon: <Clock className="size-3.5" />,
        selected: view === "state:needs-action",
        onClick: () => selectView("state:needs-action"),
      },
      {
        label: labels.stateInProcess,
        icon: <CircleDot className="size-3.5" />,
        selected: view === "state:in-process",
        onClick: () => selectView("state:in-process"),
      },
      {
        label: labels.stateCompleted,
        icon: <CheckCircle2 className="size-3.5" />,
        selected: view === "state:completed",
        onClick: () => selectView("state:completed"),
      },
      {
        label: labels.stateCancelled,
        icon: <CircleX className="size-3.5" />,
        selected: view === "state:cancelled",
        onClick: () => selectView("state:cancelled"),
      },
    ],
    [labels, selectView, view],
  );

  const prioritySidebarItems = useMemo(
    () =>
      PRIORITY_FILTER_SLUGS.map((slug) => ({
        label: priorityFilterLabel(slug, labels),
        icon: priorityFilterIcon(slug),
        selected: view === `priority:${slug}`,
        onClick: () => selectView(`priority:${slug}`),
      })),
    [labels, selectView, view],
  );

  return {
    ownInboxId,
    ownedLists,
    sharedLists,
    topSidebarItems,
    statusSidebarItems,
    prioritySidebarItems,
  };
}

export function isViewOnlyTaskList(list: TaskListSidebarEntry): boolean {
  return !canWriteTaskList(list);
}

export function isOwnedInboxSidebarList(list: TaskListSidebarEntry): boolean {
  return isInboxTaskList(list);
}
