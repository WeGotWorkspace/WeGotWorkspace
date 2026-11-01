import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, onTestFinished, vi } from "vitest";
import { createTasksAppBootstrap } from "@/lib/api/mock/tasks-bootstrap";
import { TasksRequestError } from "@/lib/api/wgw/tasks";
import { TASKS_DOMAIN } from "@/lib/offline/tasks/tasks-schema";
import {
  enqueueCoalescedTaskUpdate,
  enqueueOutboxMutation,
  listOutboxMutations,
  upsertTaskInCache,
  writeTasksBootstrapToCache,
} from "@/lib/offline/tasks-offline-store";
import { offlineAccountKeyFromUsername, offlineDbForAccount } from "@/lib/offline/offline-db";
import { tasksItemsTable, tasksListsTable } from "@/lib/offline/tasks/tasks-schema";
import { flushTasksOutbox } from "@/lib/offline/tasks-outbox-flush";
import {
  subscribeTaskWriteRefused,
  type TaskWriteRefused,
} from "@/lib/offline/tasks/tasks-refused-write";

const username = "alice";
const bootstrap = createTasksAppBootstrap({
  session: {
    ...createTasksAppBootstrap().session,
    user: { ...createTasksAppBootstrap().session.user, username },
  },
});
const task = bootstrap.data.tasks[0]!;

const { patchTask, getTask, deleteTask, createTask } = vi.hoisted(() => ({
  createTask: vi.fn(),
  patchTask: vi.fn(),
  getTask: vi.fn(),
  deleteTask: vi.fn(),
}));

vi.mock("@/lib/api/wgw/tasks", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/wgw/tasks")>();
  return {
    ...actual,
    patchTask,
    getTask,
    deleteTask,
    createTask,
    TasksRequestError: actual.TasksRequestError,
  };
});

describe("flushTasksOutbox", () => {
  beforeEach(async () => {
    patchTask.mockReset();
    getTask.mockReset();
    deleteTask.mockReset();
    createTask.mockReset();
    const db = offlineDbForAccount(offlineAccountKeyFromUsername(username));
    await db.outbox.clear();
    await tasksItemsTable(db).clear();
    await tasksListsTable(db).clear();
    await db.meta.clear();
    await writeTasksBootstrapToCache(username, bootstrap);
  });

  async function queueRename(id: string, title: string) {
    await upsertTaskInCache(username, { ...task, title }, true);
    await enqueueOutboxMutation(username, {
      id,
      domain: TASKS_DOMAIN,
      op: "update",
      payload: JSON.stringify({ taskId: task.id, patch: { title } }),
    });
  }

  async function cachedTask() {
    const db = offlineDbForAccount(offlineAccountKeyFromUsername(username));
    const row = await tasksItemsTable(db).get(task.id);
    return row ? (JSON.parse(row.data) as typeof task) : undefined;
  }

  function watchRefusals(): TaskWriteRefused[] {
    const seen: TaskWriteRefused[] = [];
    const stop = subscribeTaskWriteRefused((event) => seen.push(event));
    onTestFinished(stop);
    return seen;
  }

  it("drops a write refused as read-only and shows the server copy again (#1825)", async () => {
    const refusals = watchRefusals();
    await queueRename("queued-rename", "Mine");
    patchTask.mockRejectedValue(new TasksRequestError("PATCH /tasks/items failed (403)", 403));
    getTask.mockResolvedValue(task);

    const result = await flushTasksOutbox(username);

    expect(result.etagMismatches).toEqual([]);
    expect(await listOutboxMutations(username)).toEqual([]);
    expect((await cachedTask())?.title).toBe(task.title);
    expect(refusals).toEqual([
      { username, taskId: task.id, title: task.title, reason: "readOnly" },
    ]);
  });

  it("drops a write to a task that is gone, and its later writes (#1825)", async () => {
    const refusals = watchRefusals();
    await queueRename("queued-rename", "Mine");
    await enqueueOutboxMutation(username, {
      id: "queued-delete",
      domain: TASKS_DOMAIN,
      op: "delete",
      payload: JSON.stringify({ taskId: task.id }),
    });
    patchTask.mockRejectedValue(new TasksRequestError("PATCH /tasks/items failed (404)", 404));
    getTask.mockRejectedValue(new TasksRequestError("GET /tasks/items failed (404)", 404));

    await flushTasksOutbox(username);

    expect(await listOutboxMutations(username)).toEqual([]);
    expect(await cachedTask()).toBeUndefined();
    expect(deleteTask).not.toHaveBeenCalled();
    expect(refusals).toEqual([{ username, taskId: task.id, title: "Mine", reason: "gone" }]);
  });

  it("drops a queued delete of a task that is gone without a notice", async () => {
    const refusals = watchRefusals();
    await enqueueOutboxMutation(username, {
      id: "queued-delete",
      domain: TASKS_DOMAIN,
      op: "delete",
      payload: JSON.stringify({ taskId: task.id }),
    });
    deleteTask.mockRejectedValue(new TasksRequestError("DELETE /tasks/items failed (404)", 404));
    getTask.mockRejectedValue(new TasksRequestError("GET /tasks/items failed (404)", 404));

    await flushTasksOutbox(username);

    expect(await listOutboxMutations(username)).toEqual([]);
    expect(await cachedTask()).toBeUndefined();
    expect(refusals).toEqual([]);
  });

  it("keeps a refused write queued while the server copy cannot be read", async () => {
    const refusals = watchRefusals();
    await queueRename("queued-rename", "Mine");
    patchTask.mockRejectedValue(new TasksRequestError("PATCH /tasks/items failed (403)", 403));
    getTask.mockRejectedValue(new TypeError("Failed to fetch"));

    await flushTasksOutbox(username);

    const outbox = await listOutboxMutations(username);
    expect(outbox).toHaveLength(1);
    expect(outbox[0]?.lastStatus).toBe(403);
    expect((await cachedTask())?.title).toBe("Mine");
    expect(refusals).toEqual([]);
  });

  it("leaves an offline-created task and its edit queued when the edit gets a 404", async () => {
    const refusals = watchRefusals();
    const tempId = "local-x";
    await upsertTaskInCache(username, { ...task, id: tempId, title: "New" }, true);
    await enqueueOutboxMutation(username, {
      id: "queued-create",
      domain: TASKS_DOMAIN,
      op: "create",
      payload: JSON.stringify({
        tempTaskId: tempId,
        body: { title: "New", taskListId: task.taskListId },
      }),
    });
    await enqueueOutboxMutation(username, {
      id: "queued-edit",
      domain: TASKS_DOMAIN,
      op: "update",
      payload: JSON.stringify({ taskId: tempId, patch: { title: "Newer" } }),
    });
    createTask.mockRejectedValue(new TasksRequestError("POST /tasks/items failed (500)", 500));
    patchTask.mockRejectedValue(new TasksRequestError("PATCH /tasks/items failed (404)", 404));
    getTask.mockRejectedValue(new TasksRequestError("GET /tasks/items failed (404)", 404));

    await flushTasksOutbox(username);

    const ids = (await listOutboxMutations(username)).map((row) => row.id).sort();
    expect(ids).toEqual(["queued-create", "queued-edit"]);
    const db = offlineDbForAccount(offlineAccountKeyFromUsername(username));
    expect(await tasksItemsTable(db).get(tempId)).toBeDefined();
    expect(refusals).toEqual([]);
  });

  it("sends a patch merged in while the first one was on its way (#1711)", async () => {
    await enqueueCoalescedTaskUpdate(username, task.id, { title: "First" }, "etag-1");
    let answerFirst!: (value: unknown) => void;
    patchTask.mockReturnValueOnce(new Promise((resolve) => (answerFirst = resolve)));
    patchTask.mockResolvedValueOnce({ ...task, title: "Second", etag: "etag-3" });

    const flushing = flushTasksOutbox(username);
    await vi.waitFor(() => expect(patchTask).toHaveBeenCalledOnce());
    await upsertTaskInCache(username, { ...task, title: "Second" }, true);
    await enqueueCoalescedTaskUpdate(username, task.id, { title: "Second" }, "etag-1");
    answerFirst({ ...task, title: "First", etag: "etag-2" });
    await flushing;

    expect(patchTask).toHaveBeenCalledTimes(2);
    // Rebased on the first answer, so the second send is no stale-etag conflict.
    expect(patchTask.mock.calls[1]).toEqual([task.id, { title: "Second" }, { ifMatch: "etag-2" }]);
    expect(await listOutboxMutations(username)).toEqual([]);
    const db = offlineDbForAccount(offlineAccountKeyFromUsername(username));
    const cached = await tasksItemsTable(db).get(task.id);
    expect(JSON.parse(cached?.data ?? "{}")).toMatchObject({ title: "Second" });
  });
});
