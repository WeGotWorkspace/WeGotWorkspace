import type {
  Task,
  TaskCreate,
  TaskList,
  TaskListCreate,
  TaskListMember,
} from "@wgw/openapi-types/tasks-types";
import { isApiError } from "@/lib/api/api-error";
import { parkWrites, type ParkedWrite } from "@/lib/offline/core/parked-writes";
import type { RescueOperations } from "@/lib/offline/core/rescue-parked-writes";
import { taskCreateFromTask } from "@/lib/offline/tasks/tasks-patch-merge";
import { TASKS_DOMAIN } from "@/lib/offline/tasks/tasks-schema";

/** A refused task write waiting for a list (see `ParkedWrite`); `item` is the local task. */
export type ParkedTask = ParkedWrite<Task>;

/** The task operations a rescue needs; the Tasks hybrid operations fit. */
export type TaskRescueOperations = {
  createTask: (body: TaskCreate) => Promise<Task>;
  createTaskList?: (body: TaskListCreate) => Promise<TaskList>;
};

/** Who rescues, and the cached audience of a list, to keep only assignees the target accepts (#2172). */
export type TaskRescueAssignees = {
  username: string | null;
  readCachedMembers?: (taskListId: string) => Promise<TaskListMember[] | null>;
};

export function parkTask(
  username: string,
  task: Task,
  write: Pick<ParkedTask, "kind" | "reason" | "containerName">,
): Promise<void> {
  return parkWrites(username, TASKS_DOMAIN, [
    {
      ...write,
      domain: TASKS_DOMAIN,
      entityId: task.id,
      containerId: task.taskListId,
      title: task.title?.trim() ?? "",
      item: task,
    },
  ]);
}

type Participants = NonNullable<Task["participants"]>;

/**
 * The assignees a rescued task may keep in its new list (#2172):
 * - a `u:` person in the target's cached audience with write access, or, when
 *   nothing is cached, only the rescuer's own `u:` entry;
 * - nothing else: `e:` addresses (an address from the old list must not reach a
 *   new audience, security review of 2026-11-18), positional `attN` ids and
 *   the organizer.
 */
export function rescueParticipants(
  participants: Task["participants"],
  members: readonly TaskListMember[] | null,
  username: string | null,
): Participants | undefined {
  const own = username ? `u:${username.toLowerCase()}` : null;
  const writers = new Set(
    (members ?? []).filter((m) => m.access === "write").map((m) => `u:${m.username.toLowerCase()}`),
  );
  const kept: Participants = {};
  for (const [id, entry] of Object.entries(participants ?? {})) {
    const key = id.toLowerCase();
    if (key.startsWith("u:") && (members === null ? key === own : writers.has(key))) {
      kept[id] = entry;
    }
  }
  return Object.keys(kept).length > 0 ? kept : undefined;
}

/** Only the rescuer's own `u:` entry, when the parked task had one. */
function ownParticipantOnly(
  participants: Task["participants"],
  username: string | null,
): Participants | undefined {
  const own = username ? `u:${username.toLowerCase()}` : null;
  const entry = Object.entries(participants ?? {}).find(([id]) => id.toLowerCase() === own);
  return entry ? { [entry[0]]: entry[1] } : undefined;
}

/** A new task in `taskListId` with the parked task's fields; the server picks a new uid. */
function rescueBody(
  task: Task,
  taskListId: string,
  participants: Participants | undefined,
): TaskCreate {
  const { uid: _uid, participants: _participants, ...body } = taskCreateFromTask(task, taskListId);
  return participants ? { ...body, participants } : body;
}

export function isInvalidParticipant(error: unknown): boolean {
  return isApiError(error) && error.status === 422 && error.code === "invalid_participant";
}

/** Tasks' part of the shared rescue: make a list, and create a parked task anew in one. */
export function tasksRescueOperations(
  operations: TaskRescueOperations,
  assignees: TaskRescueAssignees = { username: null },
): RescueOperations<Task> {
  return {
    createContainer: operations.createTaskList
      ? (name) => operations.createTaskList!({ name })
      : undefined,
    createItemIn: async (taskListId, task) => {
      const members = (await assignees.readCachedMembers?.(taskListId).catch(() => null)) ?? null;
      const kept = rescueParticipants(task.participants, members, assignees.username);
      try {
        return await operations.createTask(rescueBody(task, taskListId, kept));
      } catch (error) {
        // An address that became an account outside the audience: retry once
        // with only the rescuer, and read no ids from the error.
        if (!kept || !isInvalidParticipant(error)) throw error;
        const own = ownParticipantOnly(task.participants, assignees.username);
        return operations.createTask(rescueBody(task, taskListId, own));
      }
    },
  };
}
