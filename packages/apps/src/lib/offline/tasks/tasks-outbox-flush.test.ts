import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, onTestFinished, vi } from "vitest";
import { createTasksAppBootstrap } from "@/lib/api/mock/tasks-bootstrap";
import { TasksRequestError } from "@/lib/api/wgw/tasks";
import { TASKS_DOMAIN } from "@/lib/offline/tasks/tasks-schema";
import {
  enqueueCoalescedTaskUpdate,
  enqueueOutboxMutation,
  listOutboxMutations,
  readTasksBootstrapFromCache,
  upsertTaskInCache,
  writeTasksBootstrapToCache,
} from "@/lib/offline/tasks/tasks-offline-store";
import { offlineAccountKeyFromUsername, offlineDbForAccount } from "@/lib/offline/offline-db";
import { tasksItemsTable, tasksListsTable } from "@/lib/offline/tasks/tasks-schema";
import { flushTasksOutbox } from "@/lib/offline/tasks/tasks-outbox-flush";
import {
  subscribeTaskWriteRefused,
  type TaskWriteRefused,
} from "@/lib/offline/tasks/tasks-refused-write";
import { listParkedWrites } from "@/lib/offline/core/parked-writes";

const username = "alice";
const bootstrap = createTasksAppBootstrap({
  session: {
    ...createTasksAppBootstrap().session,
    user: { ...createTasksAppBootstrap().session.user, username },
  },
});
const task = bootstrap.data.tasks[0]!;

const { createTask, deleteTask, deleteTaskList, getTask, patchTask, putTask } = vi.hoisted(() => ({
  createTask: vi.fn(),
  deleteTask: vi.fn(),
  deleteTaskList: vi.fn(),
  getTask: vi.fn(),
  patchTask: vi.fn(),
  putTask: vi.fn(),
}));

vi.mock("@/lib/api/wgw/tasks", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/wgw/tasks")>();
  return {
    ...actual,
    createTask,
    patchTask,
    getTask,
    deleteTask,
    putTask,
    deleteTaskList,
    TasksRequestError: actual.TasksRequestError,
  };
});

describe("flushTasksOutbox", () => {
  beforeEach(async () => {
    createTask.mockReset();
    patchTask.mockReset();
    getTask.mockReset();
    deleteTask.mockReset();
    putTask.mockReset();
    deleteTaskList.mockReset();
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

  /** What waits in the rescue dialog: [task id, kind, reason, list, title]. */
  async function parked() {
    return (await listParkedWrites<typeof task>(username, TASKS_DOMAIN)).map((write) => [
      write.entityId,
      write.kind,
      write.reason,
      write.containerId,
      write.item.title,
    ]);
  }

  it("parks a write refused as read-only and shows the server copy again (#1825)", async () => {
    const refusals = watchRefusals();
    await queueRename("queued-rename", "Mine");
    patchTask.mockRejectedValue(new TasksRequestError("PATCH /tasks/items failed (403)", 403));
    getTask.mockResolvedValue(task);

    const result = await flushTasksOutbox(username);

    expect(result.etagMismatches).toEqual([]);
    expect(await listOutboxMutations(username)).toEqual([]);
    expect((await cachedTask())?.title).toBe(task.title);
    expect(refusals).toEqual([
      { username, taskId: task.id, title: task.title, reason: "readOnly", parked: true },
    ]);
    expect(await parked()).toEqual([[task.id, "edit", "readOnly", task.taskListId, "Mine"]]);
  });

  it("parks a write to a task that is gone, and drops its later writes (#1825)", async () => {
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
    expect(refusals).toEqual([
      { username, taskId: task.id, title: "Mine", reason: "gone", parked: true },
    ]);
    expect(await parked()).toEqual([[task.id, "edit", "gone", task.taskListId, "Mine"]]);
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
    expect(await parked()).toEqual([]);
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
    const tempId = `local-${"ab12".repeat(8)}`;
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

  it.each([
    [403, "readOnly"],
    [404, "gone"],
  ] as const)(
    "parks a task added offline, with its edit, when the create gets a %i",
    async (status, reason) => {
      const refusals = watchRefusals();
      const tempId = `local-${"cd34".repeat(8)}`;
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
      createTask.mockRejectedValue(
        new TasksRequestError(`POST /tasks/items failed (${status})`, status),
      );

      await flushTasksOutbox(username);

      expect(await listOutboxMutations(username)).toEqual([]);
      const db = offlineDbForAccount(offlineAccountKeyFromUsername(username));
      expect(await tasksItemsTable(db).get(tempId)).toBeUndefined();
      expect(getTask).not.toHaveBeenCalled();
      expect(patchTask).not.toHaveBeenCalled();
      expect(refusals).toEqual([{ username, taskId: tempId, title: "New", reason, parked: true }]);
      expect(await parked()).toEqual([[tempId, "create", reason, task.taskListId, "New"]]);
    },
  );

  it("drops a write to a server task whose id starts with local- (#1825)", async () => {
    const refusals = watchRefusals();
    const serverId = "local-1a2b3c4d";
    await upsertTaskInCache(username, { ...task, id: serverId, title: "Local" }, false);
    await enqueueOutboxMutation(username, {
      id: "queued-edit",
      domain: TASKS_DOMAIN,
      op: "update",
      payload: JSON.stringify({ taskId: serverId, patch: { title: "Local 2" } }),
    });
    patchTask.mockRejectedValue(new TasksRequestError("PATCH /tasks/items failed (404)", 404));
    getTask.mockRejectedValue(new TasksRequestError("GET /tasks/items failed (404)", 404));

    await flushTasksOutbox(username);

    expect(await listOutboxMutations(username)).toEqual([]);
    const db = offlineDbForAccount(offlineAccountKeyFromUsername(username));
    expect(await tasksItemsTable(db).get(serverId)).toBeUndefined();
    expect(refusals).toEqual([
      { username, taskId: serverId, title: "Local", reason: "gone", parked: true },
    ]);
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

  it("sends an edit to a task created offline to the id the create got (#1816)", async () => {
    const tempId = "local-abc";
    await upsertTaskInCache(
      username,
      { ...task, id: tempId, title: "Renamed", etag: `local-etag-${tempId}` },
      true,
    );
    await enqueueOutboxMutation(username, {
      id: "queued-create",
      domain: TASKS_DOMAIN,
      op: "create",
      payload: JSON.stringify({
        creationId: tempId,
        tempTaskId: tempId,
        body: { title: "First", taskListIds: { [task.taskListId]: true } },
      }),
    });
    await enqueueCoalescedTaskUpdate(
      username,
      tempId,
      { title: "Renamed" },
      `local-etag-${tempId}`,
    );
    createTask.mockResolvedValue({ ...task, id: "server-1", title: "First", etag: "e1" });
    patchTask.mockResolvedValue({ ...task, id: "server-1", title: "Renamed", etag: "e2" });

    const result = await flushTasksOutbox(username);

    expect(patchTask).toHaveBeenCalledWith("server-1", { title: "Renamed" }, { ifMatch: "e1" });
    expect(result.etagMismatches).toEqual([]);
    expect(await listOutboxMutations(username)).toEqual([]);
    const db = offlineDbForAccount(offlineAccountKeyFromUsername(username));
    expect(await tasksItemsTable(db).get(tempId)).toBeUndefined();
    const cached = await tasksItemsTable(db).get("server-1");
    expect(cached?.pendingSync).toBe(false);
    expect(JSON.parse(cached?.data ?? "{}")).toMatchObject({ title: "Renamed", etag: "e2" });
  });

  it("sends a rename queued after a move from the version the move produced (#1814)", async () => {
    await upsertTaskInCache(
      username,
      { ...task, taskListId: "work", title: "Renamed", etag: "e0" },
      true,
    );
    await enqueueOutboxMutation(username, {
      id: "queued-move",
      domain: TASKS_DOMAIN,
      op: "move",
      payload: JSON.stringify({ taskId: task.id, taskListId: "work" }),
      ifInState: "e0",
    });
    await enqueueCoalescedTaskUpdate(username, task.id, { title: "Renamed" }, "e0");
    putTask.mockResolvedValue({ ...task, taskListId: "work", title: "Renamed", etag: "e1" });
    patchTask.mockResolvedValue({ ...task, taskListId: "work", title: "Renamed", etag: "e2" });

    const result = await flushTasksOutbox(username);

    expect(putTask).toHaveBeenCalledWith(
      task.id,
      expect.objectContaining({ taskListIds: { work: true }, title: "Renamed" }),
      { ifMatch: "e0" },
    );
    expect(patchTask).toHaveBeenCalledWith(task.id, { title: "Renamed" }, { ifMatch: "e1" });
    expect(result.etagMismatches).toEqual([]);
    expect(await listOutboxMutations(username)).toEqual([]);
  });

  it("sends a move again when undo pointed it back while it was on its way", async () => {
    await upsertTaskInCache(username, { ...task, taskListId: "work", etag: "e0" }, true);
    await enqueueOutboxMutation(username, {
      id: "queued-move",
      domain: TASKS_DOMAIN,
      op: "move",
      payload: JSON.stringify({ taskId: task.id, taskListId: "work" }),
      ifInState: "e0",
    });
    let answerFirst!: (value: unknown) => void;
    putTask.mockReturnValueOnce(new Promise((resolve) => (answerFirst = resolve)));
    putTask.mockResolvedValueOnce({ ...task, etag: "e2" });

    const flushing = flushTasksOutbox(username);
    await vi.waitFor(() => expect(putTask).toHaveBeenCalledOnce());
    // Undo offline rewrites the queued row in place (see queueOfflineMove).
    const db = offlineDbForAccount(offlineAccountKeyFromUsername(username));
    const row = await db.outbox.get("queued-move");
    await db.outbox.put({
      ...row!,
      payload: JSON.stringify({ taskId: task.id, taskListId: task.taskListId }),
    });
    await upsertTaskInCache(username, { ...task, etag: "e0" }, true);
    answerFirst({ ...task, taskListId: "work", etag: "e1" });
    await flushing;

    expect(putTask).toHaveBeenCalledTimes(2);
    expect(putTask.mock.calls[1]).toEqual([
      task.id,
      expect.objectContaining({ taskListIds: { [task.taskListId]: true } }),
      { ifMatch: "e1" },
    ]);
    expect(await listOutboxMutations(username)).toEqual([]);
  });

  it("keeps the local copy while a later write for the task is still owed", async () => {
    await upsertTaskInCache(
      username,
      { ...task, taskListId: "work", title: "Renamed", etag: "e0" },
      true,
    );
    await enqueueOutboxMutation(username, {
      id: "queued-move",
      domain: TASKS_DOMAIN,
      op: "move",
      payload: JSON.stringify({ taskId: task.id, taskListId: "work" }),
      ifInState: "e0",
    });
    await enqueueCoalescedTaskUpdate(username, task.id, { title: "Renamed" }, "e0");
    putTask.mockResolvedValue({ ...task, taskListId: "work", title: "Moved only", etag: "e1" });
    patchTask.mockRejectedValue(new TypeError("Failed to fetch"));

    await flushTasksOutbox(username);

    const outbox = await listOutboxMutations(username);
    expect(outbox.map((row) => [row.op, row.ifInState])).toEqual([["update", "e1"]]);
    const db = offlineDbForAccount(offlineAccountKeyFromUsername(username));
    const cached = await tasksItemsTable(db).get(task.id);
    expect(cached?.pendingSync).toBe(true);
    expect(JSON.parse(cached?.data ?? "{}")).toMatchObject({ title: "Renamed", etag: "e1" });
  });

  it("keeps server-only fields on the local copy while a later write is owed", async () => {
    const tempId = "local-fields";
    await upsertTaskInCache(username, { ...task, id: tempId, title: "Renamed" }, true);
    await enqueueOutboxMutation(username, {
      id: "queued-create",
      domain: TASKS_DOMAIN,
      op: "create",
      payload: JSON.stringify({
        creationId: tempId,
        tempTaskId: tempId,
        body: { title: "First", taskListIds: { [task.taskListId]: true } },
      }),
    });
    await enqueueCoalescedTaskUpdate(username, tempId, { title: "Renamed" }, undefined);
    createTask.mockResolvedValue({
      ...task,
      id: "srv-1",
      etag: "e1",
      showWithoutTime: true,
      timeZone: "Europe/Berlin",
    });
    patchTask.mockRejectedValue(new TypeError("Failed to fetch"));

    await flushTasksOutbox(username);

    const db = offlineDbForAccount(offlineAccountKeyFromUsername(username));
    const cached = await tasksItemsTable(db).get("srv-1");
    expect(JSON.parse(cached?.data ?? "{}")).toMatchObject({
      title: "Renamed",
      showWithoutTime: true,
      timeZone: "Europe/Berlin",
    });
  });

  it("holds a task's later writes when an earlier one fails", async () => {
    const tempId = "local-held";
    await upsertTaskInCache(username, { ...task, id: tempId, title: "Renamed" }, true);
    await enqueueOutboxMutation(username, {
      id: "queued-create",
      domain: TASKS_DOMAIN,
      op: "create",
      payload: JSON.stringify({
        creationId: tempId,
        tempTaskId: tempId,
        body: { title: "First", taskListIds: { [task.taskListId]: true } },
      }),
    });
    await enqueueCoalescedTaskUpdate(username, tempId, { title: "Renamed" }, undefined);
    createTask.mockRejectedValue(new TasksRequestError("POST /tasks/items failed (500)", 500));

    await flushTasksOutbox(username);

    expect(patchTask).not.toHaveBeenCalled();
    const outbox = await listOutboxMutations(username);
    expect(outbox.map((row) => [row.op, row.retries])).toEqual([
      ["create", 1],
      ["update", 0],
    ]);
  });

  it("does not send a rename after a move the server refused as a conflict", async () => {
    await enqueueOutboxMutation(username, {
      id: "queued-move",
      domain: TASKS_DOMAIN,
      op: "move",
      payload: JSON.stringify({ taskId: task.id, taskListId: "work" }),
      ifInState: "e0",
    });
    await enqueueCoalescedTaskUpdate(username, task.id, { title: "Renamed" }, "e0");
    putTask.mockRejectedValue(new TasksRequestError("PUT /tasks/items failed (412)", 412));

    const result = await flushTasksOutbox(username);

    expect(result.etagMismatches).toEqual([task.id]);
    expect(patchTask).not.toHaveBeenCalled();
  });

  it("moves a task created offline with the due fields only the create answer has", async () => {
    const tempId = "local-move";
    // The optimistic row of an older app version had no due flags.
    await upsertTaskInCache(
      username,
      { ...task, id: tempId, taskListId: "work", due: "2026-11-08T09:00:00" },
      true,
    );
    await enqueueOutboxMutation(username, {
      id: "queued-create",
      domain: TASKS_DOMAIN,
      op: "create",
      payload: JSON.stringify({
        creationId: tempId,
        tempTaskId: tempId,
        body: { title: task.title, taskListIds: { [task.taskListId]: true } },
      }),
    });
    await enqueueOutboxMutation(username, {
      id: "queued-move",
      domain: TASKS_DOMAIN,
      op: "move",
      payload: JSON.stringify({ taskId: tempId, taskListId: "work" }),
      ifInState: `local-etag-${tempId}`,
    });
    const created = {
      ...task,
      id: "server-2",
      due: "2026-11-08T09:00:00",
      showWithoutTime: false,
      timeZone: "Europe/Amsterdam",
      etag: "e1",
    };
    createTask.mockResolvedValue(created);
    putTask.mockResolvedValue({ ...created, taskListId: "work", etag: "e2" });

    await flushTasksOutbox(username);

    expect(putTask).toHaveBeenCalledWith(
      "server-2",
      expect.objectContaining({
        taskListIds: { work: true },
        due: "2026-11-08T09:00:00",
        showWithoutTime: false,
        timeZone: "Europe/Amsterdam",
      }),
      { ifMatch: "e1" },
    );
    expect(await listOutboxMutations(username)).toEqual([]);
  });

  it("drops only the deleted list's tasks from the cache on a queued list delete (#1812)", async () => {
    await enqueueOutboxMutation(username, {
      id: "queued-list-delete",
      domain: TASKS_DOMAIN,
      op: "listDelete",
      payload: JSON.stringify({ taskListId: "work", onDestroyRemoveContents: true }),
    });
    deleteTaskList.mockResolvedValue(undefined);

    await flushTasksOutbox(username);

    expect(deleteTaskList).toHaveBeenCalledWith("work", { onDestroyRemoveContents: true });
    const cached = await readTasksBootstrapFromCache(username);
    const kept = bootstrap.data.tasks.filter((entry) => entry.taskListId !== "work");
    expect(kept.length).toBeGreaterThan(0);
    expect(cached?.data.tasks.map((entry) => entry.id).sort()).toEqual(
      kept.map((entry) => entry.id).sort(),
    );
    expect(cached?.data.taskLists.map((list) => list.id)).not.toContain("work");
    expect(await listOutboxMutations(username)).toEqual([]);
  });
});
