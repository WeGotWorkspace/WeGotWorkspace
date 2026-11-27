import { useCallback, useEffect, useMemo, useState } from "react";
import type { TaskList, TaskListMember, TaskListMembersResult } from "@/lib/models/tasks-types";
import { canWriteTaskList } from "@/lib/models/task-lists";
import { assigneeParticipant, memberParticipantId } from "@/tasks-core/src/tasks-assignees";
import { emptyTaskForm, type TasksTaskFormValue } from "@/tasks-core/src/tasks-task-form";
import {
  ASSIGNED_TO_ME_VIEW,
  ASSIGNEE_VIEW_PREFIX,
  composerDefaultDueForView,
  isAssigneeView,
} from "@/tasks-core/src/tasks-task-utils";
import { useTasksNewTaskPrefs } from "@/lib/tasks-new-task-prefs";
import { useAssigneeTargetLists } from "@/tasks-core/src/use-assignee-target-lists";

export type QuickAddList = { id: string; name: string; color?: string | null };

/**
 * Where the quick add field puts a new task, by the view you are in:
 *  - a list view: that list;
 *  - a colleague's "Assigned to" view: the lists you share with them (the first is
 *    picked), and the task is assigned to them;
 *  - "Assigned to" you: every list you can write to, assigned to you;
 *  - any other view: every list you can write to, your default list picked.
 * The menu beside the field shows these lists and keeps the choice until the view changes.
 */
export function useQuickAddTarget({
  view,
  taskLists,
  defaultListId,
  me,
  loadMembers,
  createTask,
}: {
  view: string;
  taskLists: readonly TaskList[];
  /** Your default list: picked first outside a list view. */
  defaultListId: string;
  me: { username: string; displayName: string; email: string | null };
  loadMembers?: (taskListId: string) => Promise<TaskListMembersResult>;
  createTask: (form: TasksTaskFormValue) => Promise<void>;
}) {
  const colleague = isAssigneeView(view) ? view.slice(ASSIGNEE_VIEW_PREFIX.length) : null;
  const targets = useAssigneeTargetLists({
    username: colleague,
    lists: taskLists,
    loadMembers,
  });
  const newTaskPrefs = useTasksNewTaskPrefs();
  const [pickedId, setPickedId] = useState<string | null>(null);
  useEffect(() => setPickedId(null), [view]);

  const lists = useMemo<QuickAddList[]>(() => {
    if (colleague !== null) return targets.options;
    const writable = taskLists.filter((list) => canWriteTaskList(list));
    if (view.startsWith("list:")) return writable.filter((list) => list.id === view.slice(5));
    return writable;
  }, [colleague, targets.options, taskLists, view]);

  const selected =
    lists.find((list) => list.id === pickedId) ??
    (colleague === null ? lists.find((list) => list.id === defaultListId) : undefined) ??
    lists[0];

  const meMember = useMemo<TaskListMember>(
    () => ({
      username: me.username,
      displayName: me.displayName,
      email: me.email,
      access: "write",
    }),
    [me.displayName, me.email, me.username],
  );

  const add = useCallback(
    (title: string) => {
      if (!selected) return;
      const assignee =
        colleague !== null
          ? targets.options.find((option) => option.id === selected.id)?.member
          : view === ASSIGNED_TO_ME_VIEW
            ? meMember
            : undefined;
      if (colleague !== null && !assignee) return;
      void createTask({
        ...emptyTaskForm(selected.id),
        // What a new task starts with (Tasks settings).
        priority: newTaskPrefs.priority,
        workflowStatus: newTaskPrefs.status,
        // A colleague's view says nothing about the due date; the others follow their view.
        ...(colleague === null ? { due: composerDefaultDueForView(view) } : {}),
        title,
        ...(assignee
          ? { participants: { [memberParticipantId(assignee)]: assigneeParticipant(assignee) } }
          : {}),
      });
    },
    [colleague, createTask, meMember, newTaskPrefs, selected, targets.options, view],
  );

  return {
    lists,
    listId: selected?.id,
    setListId: setPickedId,
    /** Nothing to pick in a colleague's view means no list is shared with them. */
    noSharedList: colleague !== null && selected === undefined && !targets.loading,
    canAdd: selected !== undefined,
    add,
  };
}
