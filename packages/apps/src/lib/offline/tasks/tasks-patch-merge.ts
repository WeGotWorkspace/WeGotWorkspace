import type { Task, TaskCreate, TaskPatch } from "@/lib/models/tasks-types";
import { applyTaskAlertsPatch } from "@/lib/models/task-alerts";

export function taskEtag(task: Task): string | undefined {
  return (task as Task & { etag?: string }).etag;
}

type TaskParticipants = NonNullable<Task["participants"]>;
type TaskParticipantsPatch = TaskPatch["participants"];

/**
 * Participants merge per id, as the server does (#2172): an entry replaces that
 * person, a null entry removes them, and `participants: null` clears them all.
 */
export function applyTaskParticipantsPatch(
  current: Task["participants"],
  patch: TaskParticipantsPatch,
): TaskParticipants | undefined {
  if (patch === undefined) return current ?? undefined;
  if (patch === null) return undefined;
  const next: Record<string, TaskParticipants[string]> = { ...(current ?? {}) };
  for (const [id, entry] of Object.entries(patch)) {
    if (entry === null) delete next[id];
    else next[id] = entry as TaskParticipants[string];
  }
  return Object.keys(next).length > 0 ? (next as TaskParticipants) : undefined;
}

/** Applies a patch as the API does; alerts and participants merge per id and a null entry removes one. */
export function applyTaskPatch(task: Task, patch: TaskPatch): Task {
  const { alerts, participants, ...rest } = patch;
  const next: Task = { ...task, ...rest };
  if (participants !== undefined) {
    const mergedParticipants = applyTaskParticipantsPatch(task.participants, participants);
    if (mergedParticipants) next.participants = mergedParticipants;
    else delete next.participants;
  }
  if (alerts === undefined) return next;
  const merged = applyTaskAlertsPatch(task.alerts, alerts);
  if (merged) next.alerts = merged;
  else delete next.alerts;
  return next;
}

/**
 * A queued patch that clears every alert, written as a null per alert id the task has.
 * The API merges alerts per id, so a bare `alerts: null` coalesced with a later new
 * alert would become just that alert, and the server would keep the old ones.
 */
export function withExplicitAlertsClear(patch: TaskPatch, base: Task): TaskPatch {
  if (patch.alerts !== null) return patch;
  const ids = Object.keys(base.alerts ?? {});
  if (ids.length === 0) return patch;
  return { ...patch, alerts: Object.fromEntries(ids.map((id) => [id, null])) };
}

/** Two queued patches as one: the later wins, alert by alert and person by person. */
export function coalesceTaskPatches(a: TaskPatch, b: TaskPatch): TaskPatch {
  const merged = { ...a, ...b };
  if (a.alerts && b.alerts) merged.alerts = { ...a.alerts, ...b.alerts };
  if (a.participants && b.participants)
    merged.participants = { ...a.participants, ...b.participants };
  return merged;
}

/** Build a PUT body for moving or replacing a task in a target list. */
export function taskCreateFromTask(task: Task, taskListId: string): TaskCreate {
  return {
    title: task.title ?? "",
    taskListIds: { [taskListId]: true },
    uid: task.uid,
    description: task.description,
    start: task.start,
    due: task.due,
    completed: task.completed,
    showWithoutTime: task.showWithoutTime,
    timeZone: task.timeZone,
    workflowStatus: task.workflowStatus,
    progress: task.progress,
    priority: task.priority,
    categories: task.categories,
    privacy: task.privacy,
    recurrenceRules: task.recurrenceRules,
    excludedRecurrenceDates: task.excludedRecurrenceDates,
    recurrenceOverrides: task.recurrenceOverrides,
    alerts: task.alerts,
    participants: task.participants,
    icsProps: task.icsProps,
  };
}
