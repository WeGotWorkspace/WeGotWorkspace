import { useCallback, useRef } from "react";
import type { Task, TaskPatch } from "@/tasks-core/src/tasks-types";
import type { TasksTaskFormValue } from "@/tasks-core/src/tasks-task-form";
import { taskAlertsPatch } from "@/tasks-core/src/tasks-alert-mapping";
import { normalizeTaskPriority, TASK_PRIORITY_NONE } from "@/tasks-core/src/tasks-priority";
import {
  canWriteTaskList,
  dueEditSendsShowWithoutTime,
  taskAlertsEqual,
} from "@/tasks-core/src/tasks-task-utils";
import type { TasksShellState } from "@/tasks-core/src/use-tasks-shell";

function taskEditValues(input: TasksTaskFormValue) {
  const due = input.due ?? null;
  return {
    title: input.title.trim(),
    description: input.description.trim() || null,
    workflowStatus: input.workflowStatus ?? "needs-action",
    priority: input.priority === TASK_PRIORITY_NONE ? null : input.priority,
    due,
    showWithoutTime: due ? (input.showWithoutTime ?? true) : undefined,
    timeZone: due && input.showWithoutTime === false ? (input.timeZone ?? null) : null,
    alerts: input.alerts,
  };
}

function taskEditPatch(task: Task, next: ReturnType<typeof taskEditValues>): TaskPatch {
  const patch: TaskPatch = {};
  if (next.title !== (task.title ?? "")) patch.title = next.title;
  if (next.description !== (task.description?.trim() || null)) {
    patch.description = next.description;
  }
  if (next.due !== (task.due ?? null)) patch.due = next.due;
  if (dueEditSendsShowWithoutTime(task, next.due, next.showWithoutTime)) {
    patch.showWithoutTime = next.showWithoutTime;
  }
  if (next.due && next.timeZone !== (task.timeZone ?? null)) patch.timeZone = next.timeZone;
  if (!next.due && (task.due ?? null) !== null) {
    patch.due = null;
    patch.showWithoutTime = true;
    patch.timeZone = null;
  }
  if (next.workflowStatus !== (task.workflowStatus ?? "needs-action")) {
    patch.workflowStatus = next.workflowStatus;
  }
  if (next.priority !== normalizeTaskPriority(task.priority)) patch.priority = next.priority;
  if (!taskAlertsEqual(next.alerts, task.alerts)) {
    patch.alerts = taskAlertsPatch(task.alerts, next.alerts);
  }
  return patch;
}

type PatchTask = (
  taskId: string,
  patch: TaskPatch,
  opts?: { signal?: AbortSignal; ifMatch?: string },
) => Promise<Task | undefined>;

type UseTaskDetailAutosaveArgs = Pick<
  TasksShellState,
  "tasks" | "taskLists" | "setTasks" | "operations" | "showMutationError"
> & {
  patchTask: PatchTask;
};

type TaskFields = Partial<Task>;

/** The fields of `next` a patch changes, to show (or take back) without touching the rest. */
function patchedFields(
  patch: TaskPatch,
  next: ReturnType<typeof taskEditValues>,
  listId: string | null,
): TaskFields {
  const fields: TaskFields = {};
  for (const key of Object.keys(patch) as (keyof TaskPatch)[]) {
    if (key in next) Object.assign(fields, { [key]: next[key as keyof typeof next] });
  }
  if (listId) fields.taskListId = listId;
  return fields;
}

function pickFields(task: Task, fields: TaskFields): TaskFields {
  const picked: TaskFields = {};
  for (const key of Object.keys(fields) as (keyof Task)[]) {
    Object.assign(picked, { [key]: task[key] });
  }
  return picked;
}

/**
 * Writes to one task run one after the other on that task's chain, each against the
 * version the previous one produced, or the server refuses the second as a conflict.
 * The detail autosave and the done box (detail and list row) both write here, so a
 * toggle never races a save of typed text. No toast and the pane stays open (like Notes).
 */
export function useTaskDetailAutosave({
  tasks,
  taskLists,
  setTasks,
  operations,
  patchTask,
  showMutationError,
}: UseTaskDetailAutosaveArgs) {
  const tasksRef = useRef(tasks);
  tasksRef.current = tasks;
  const taskListsRef = useRef(taskLists);
  taskListsRef.current = taskLists;
  const savedEtagsRef = useRef(new Map<string, string>());
  const saveChainsRef = useRef(new Map<string, Promise<void>>());
  // What writes still on a task's chain show: a server copy from an earlier write
  // must not flip them back while they wait.
  const overlaysRef = useRef(new Map<string, Set<TaskFields>>());

  const showOverlay = useCallback(
    (taskId: string, fields: TaskFields) => {
      const overlays = overlaysRef.current;
      const set = overlays.get(taskId) ?? new Set<TaskFields>();
      set.add(fields);
      overlays.set(taskId, set);
      return () => {
        set.delete(fields);
        if (set.size === 0) overlays.delete(taskId);
        if (set.size === 0) return;
        const pending = Object.assign({}, ...set) as TaskFields;
        setTasks((prev) =>
          prev.map((item) => (item.id === taskId ? { ...item, ...pending } : item)),
        );
      };
    },
    [setTasks],
  );

  /** The version the next write to the task starts from. */
  const etagFor = useCallback((taskId: string, fallback?: Task) => {
    const task = fallback ?? tasksRef.current.find((item) => item.id === taskId);
    return (
      savedEtagsRef.current.get(taskId) ?? (task as (Task & { etag?: string }) | undefined)?.etag
    );
  }, []);

  /**
   * Remembers a version the server returned, for the next write on the chain and, in
   * the task itself, for a write after the chain went idle.
   */
  const remember = useCallback(
    (taskId: string, saved: Task | undefined) => {
      const etag = (saved as (Task & { etag?: string }) | undefined)?.etag;
      if (!saved || !etag) return;
      savedEtagsRef.current.set(taskId, etag);
      const withEtag = (item: Task) => (item.id === taskId ? { ...item, etag } : item);
      tasksRef.current = tasksRef.current.map(withEtag);
      setTasks((prev) => prev.map(withEtag));
    },
    [setTasks],
  );

  const enqueue = useCallback(<T>(taskId: string, write: () => Promise<T>): Promise<T> => {
    const chains = saveChainsRef.current;
    const run = (chains.get(taskId) ?? Promise.resolve()).then(write);
    const settled = run.then(
      () => {},
      () => {},
    );
    chains.set(taskId, settled);
    void settled.then(() => {
      // Idle again: later writes read the etag from the task (it may have synced).
      if (chains.get(taskId) !== settled) return;
      chains.delete(taskId);
      savedEtagsRef.current.delete(taskId);
    });
    return run;
  }, []);

  /**
   * One patch on the task's chain, after every write queued before it. `shown` is
   * what the screen already shows for it (an optimistic toggle).
   */
  const patchTaskInOrder = useCallback(
    (taskId: string, patch: TaskPatch, opts?: { signal?: AbortSignal; shown?: TaskFields }) => {
      const done = showOverlay(taskId, opts?.shown ?? {});
      return enqueue(taskId, async () => {
        try {
          const updated = await patchTask(taskId, patch, {
            signal: opts?.signal,
            ifMatch: etagFor(taskId),
          });
          remember(taskId, updated);
          return updated;
        } finally {
          done();
        }
      });
    },
    [enqueue, etagFor, patchTask, remember, showOverlay],
  );

  /** A done toggle (or its undo) on the task's chain; the screen already shows it. */
  const setStatusInOrder = useCallback(
    (taskId: string, status: NonNullable<Task["workflowStatus"]>, signal?: AbortSignal) => {
      const shown = { workflowStatus: status };
      return patchTaskInOrder(taskId, shown, { signal, shown });
    },
    [patchTaskInOrder],
  );

  const saveTaskNow = useCallback(
    async (taskId: string, input: TasksTaskFormValue) => {
      if (!operations) return;
      const task = tasksRef.current.find((item) => item.id === taskId);
      if (!task) return;
      const lists = taskListsRef.current;
      if (!canWriteTaskList(lists.find((list) => list.id === task.taskListId))) return;
      // A blank title keeps the stored one. A task synced in without a title stays
      // untitled; its other fields still save.
      const title = input.title.trim() || task.title || "";

      const next = taskEditValues({ ...input, title });
      const listChanged = input.listId !== task.taskListId;
      const patch = taskEditPatch(task, next);
      const hasPatch = Object.keys(patch).length > 0;
      if (!hasPatch && !listChanged) return;

      // Show and take back only what this save changes: a done toggle or another
      // write that lands meanwhile keeps its own fields.
      const shown = patchedFields(patch, next, listChanged ? input.listId : null);
      let undo = pickFields(task, shown);
      const apply = (fields: TaskFields) => (item: Task) =>
        item.id === taskId ? { ...item, ...fields } : item;
      tasksRef.current = tasksRef.current.map(apply(shown));
      setTasks((prev) => prev.map(apply(shown)));
      const done = showOverlay(taskId, shown);

      try {
        let etag = etagFor(taskId, task);
        if (listChanged) {
          // Same as the edit dialog: the move carries no precondition (#1814).
          const moved = await operations.moveTaskToList(taskId, input.listId);
          if (moved) {
            const { taskListId: _landed, ...rest } = undo;
            undo = rest;
            // Kept at once: the patch below may fail, and the move did land.
            remember(taskId, moved);
            etag = etagFor(taskId);
          }
        }
        if (hasPatch) {
          remember(taskId, await patchTask(taskId, patch, { ifMatch: etag }));
        }
      } catch {
        tasksRef.current = tasksRef.current.map(apply(undo));
        setTasks((prev) => prev.map(apply(undo)));
        showMutationError();
      } finally {
        done();
      }
    },
    [etagFor, operations, patchTask, remember, setTasks, showMutationError, showOverlay],
  );

  const autosaveTask = useCallback(
    (taskId: string, input: TasksTaskFormValue): Promise<void> =>
      enqueue(taskId, () => saveTaskNow(taskId, input)),
    [enqueue, saveTaskNow],
  );

  return { autosaveTask, setStatusInOrder };
}
