import { getTask } from "@/lib/api/wgw/tasks";
import { crossTabTopic } from "@/lib/offline/core/cross-tab-topic";
import { httpStatusFromFlushError } from "@/lib/offline/core/outbox-error-status";
import {
  listOutboxMutationsForDomain,
  removeOutboxMutation,
} from "@/lib/offline/core/outbox-store";
import type { OfflineOutboxRow } from "@/lib/offline/core/types";
import { parkTask } from "@/lib/offline/tasks/tasks-parked-writes";
import { TASKS_DOMAIN } from "@/lib/offline/tasks/tasks-schema";
import {
  readTasksBootstrapFromCache,
  removeTaskFromCache,
  tasksOutboxTaskId,
  upsertTaskInCache,
} from "@/lib/offline/tasks-offline-store";

/**
 * The server refused a queued task write for good (#1825): the task or its
 * list is gone for this person, or they can only view the list now. The write
 * leaves the queue and the task goes back to what the server has. A task added
 * offline, or offline changes to a task, are parked (`parkTask`) so the person
 * can keep them in another list; what cannot be kept that way gets a notice in
 * every tab, the way Notes does for a note deleted elsewhere.
 *
 * - `gone`: the server no longer shows the task (or its list) to this person.
 * - `readOnly`: 403, the list is view-only now; the task shows the server copy again.
 * - `notSaved`: 404 on a task the server still has (a move into a list that is gone).
 */
export type TaskWriteRefusal = "gone" | "readOnly" | "notSaved";
export type TaskWriteRefused = {
  username: string;
  taskId: string;
  title: string;
  reason: TaskWriteRefusal;
  /** Parked for a rescue: the rescue dialog tells the person, not a notice. */
  parked: boolean;
};

const topic = crossTabTopic(
  "wgw-tasks-write-refused",
  (value): value is TaskWriteRefused =>
    typeof (value as TaskWriteRefused | null)?.taskId === "string",
);

export const announceTaskWriteRefused = (event: TaskWriteRefused): void => topic.publish(event);
export const subscribeTaskWriteRefused = topic.subscribe;

/** Shape of `createTempTaskId`; a server id like `local-1a2b3c4d` (a task titled "Local") differs. */
const TEMP_TASK_ID = /^local-[0-9a-f]{32}$/;
const TASK_OPS = new Set(["create", "update", "move", "delete"]);

function isRefusedStatus(error: unknown): boolean {
  const status = httpStatusFromFlushError(error);
  return status === 403 || status === 404;
}

/**
 * A 403 or 404 on a queued create, or on a queued write to a task the server
 * has. Other rows keep the usual handling, also an edit to a temp id: that task
 * is not on the server (yet), and its create decides what happens to it.
 */
export function isRefusedTaskWrite(row: OfflineOutboxRow, error: unknown): boolean {
  if (!TASK_OPS.has(row.op) || !isRefusedStatus(error)) return false;
  return row.op === "create" || !TEMP_TASK_ID.test(tasksOutboxTaskId(row) ?? "");
}

/** A create has no server copy to read, so its status alone says why. */
function refusalReason(created: boolean, onServer: boolean, forbidden: boolean): TaskWriteRefusal {
  if (created) return forbidden ? "readOnly" : "gone";
  if (!onServer) return "gone";
  return forbidden ? "readOnly" : "notSaved";
}

/**
 * Drop every queued write for the task and put the server's copy in the cache,
 * or take the task out when the server no longer shows it. Throws while the
 * server copy cannot be read (offline, 5xx), so the row stays for the next flush.
 * A refused create has no server copy: the task added offline leaves the cache.
 */
export async function settleRefusedTaskWrite(
  username: string,
  row: OfflineOutboxRow,
  error: unknown,
): Promise<string | null> {
  const taskId = tasksOutboxTaskId(row);
  if (!taskId) return null;

  const created = row.op === "create";
  let serverTask: Awaited<ReturnType<typeof getTask>> | null = null;
  try {
    if (!created) serverTask = await getTask(taskId);
  } catch (readError) {
    if (!isRefusedStatus(readError)) throw readError;
  }

  const cached = await readTasksBootstrapFromCache(username);
  // Name the task as it shows from now on: the server copy, else the local one.
  const local = cached?.data.tasks.find((task) => task.id === taskId);
  const title = (serverTask?.title || local?.title)?.trim() ?? "";
  for (const queued of await listOutboxMutationsForDomain(username, TASKS_DOMAIN)) {
    if (tasksOutboxTaskId(queued) === taskId) await removeOutboxMutation(username, queued.id);
  }
  if (serverTask) await upsertTaskInCache(username, serverTask, false);
  else await removeTaskFromCache(username, taskId);

  // A queued delete of a task that is gone already has the outcome the person asked for.
  if (row.op === "delete" && !serverTask) return taskId;
  const forbidden = httpStatusFromFlushError(error) === 403;
  const reason = refusalReason(created, Boolean(serverTask), forbidden);
  // Something of the person's own to keep: a task added offline, or offline changes.
  const parked = Boolean(local) && row.op !== "delete" && reason !== "notSaved";
  if (local && parked) {
    const list = cached?.data.taskLists.find((entry) => entry.id === local.taskListId);
    await parkTask(username, local, {
      kind: created ? "create" : "edit",
      reason: reason === "readOnly" ? "readOnly" : "gone",
      containerName: list?.name ?? "",
    });
  }
  announceTaskWriteRefused({ username, taskId, title, reason, parked });
  return taskId;
}
