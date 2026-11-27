import { useCallback, useMemo } from "react";
import { Calendar, CalendarClock, CircleAlert, LayoutList } from "lucide-react";
import { useAuthorPresence } from "@/presence-core/src/use-author-presence";
import { UserAvatar } from "@/user-avatar/src/user-avatar";
import { avatarColorForUserId } from "@/user-avatar/src/user-avatar-color";
import { partitionOwnedAndShared } from "@/collection-sidebar/src/collection-sidebar-partition";
import type { TasksUILabels } from "@/tasks-core/src/tasks-labels";
import type { TaskAssigneePerson } from "@/tasks-core/src/tasks-assignees";
import {
  ASSIGNED_TO_ME_VIEW,
  assigneeView,
  defaultTaskListId,
} from "@/tasks-core/src/tasks-task-utils";
import {
  canWriteTaskList,
  isInboxTaskList,
  sortSidebarTaskLists,
  type TaskListSidebarEntry,
} from "@/lib/models/task-lists";

type UseTasksSidebarModelArgs = {
  labels: TasksUILabels;
  view: string;
  taskLists: TaskListSidebarEntry[];
  /** Colleagues with shared tasks, for the "Assigned to" section (Me comes first). */
  assigneePeople?: readonly TaskAssigneePerson[];
  /** The signed-in person, for the Me row. */
  me?: TaskAssigneePerson;
  selectView: (view: string) => void;
};

export function useTasksSidebarModel({
  labels,
  view,
  taskLists,
  assigneePeople = [],
  me,
  selectView,
}: UseTasksSidebarModelArgs) {
  const ownInboxId = useMemo(() => defaultTaskListId(taskLists), [taskLists]);

  const { owned: ownedLists, shared: sharedLists } = useMemo(() => {
    const partitioned = partitionOwnedAndShared(taskLists);
    return {
      owned: sortSidebarTaskLists(partitioned.owned),
      shared: sortSidebarTaskLists(partitioned.shared),
    };
  }, [taskLists]);

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

  // The small avatars of the assignee chips, with the live online dot.
  const presence = useAuthorPresence();
  const personIcon = useCallback(
    (person: TaskAssigneePerson) => (
      // Decorative: the row's label is the name; the initials would only repeat it.
      <span aria-hidden className="contents">
        <UserAvatar
          compact
          size="xs"
          className="tasks-sidebar-avatar"
          displayName={person.name}
          ariaLabel={person.name}
          color={avatarColorForUserId(`u:${person.username.toLowerCase()}`)}
          presence={presence ? (presence[person.username] ?? "offline") : undefined}
        />
      </span>
    ),
    [presence],
  );

  const assignedToItems = useMemo(
    () => [
      {
        label: labels.assignedToMeRow(me?.name ?? "Me"),
        icon: me ? personIcon(me) : undefined,
        selected: view === ASSIGNED_TO_ME_VIEW,
        onClick: () => selectView(ASSIGNED_TO_ME_VIEW),
      },
      ...assigneePeople.map((person) => ({
        label: person.name,
        icon: personIcon(person),
        selected: view === assigneeView(person.username),
        onClick: () => selectView(assigneeView(person.username)),
      })),
    ],
    [assigneePeople, labels, me, personIcon, selectView, view],
  );

  return {
    ownInboxId,
    assignedToItems,
    ownedLists,
    sharedLists,
    topSidebarItems,
  };
}

export function isViewOnlyTaskList(list: TaskListSidebarEntry): boolean {
  return !canWriteTaskList(list);
}

export function isOwnedInboxSidebarList(list: TaskListSidebarEntry): boolean {
  return isInboxTaskList(list);
}
