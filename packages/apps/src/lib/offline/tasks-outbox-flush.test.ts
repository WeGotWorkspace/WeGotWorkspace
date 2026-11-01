import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";
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

const username = "alice";
const bootstrap = createTasksAppBootstrap({
  session: {
    ...createTasksAppBootstrap().session,
    user: { ...createTasksAppBootstrap().session.user, username },
  },
});
const task = bootstrap.data.tasks[0]!;

const { createTask, patchTask, putTask } = vi.hoisted(() => ({
  createTask: vi.fn(),
  patchTask: vi.fn(),
  putTask: vi.fn(),
}));

vi.mock("@/lib/api/wgw/tasks", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/wgw/tasks")>();
  return {
    ...actual,
    createTask,
    patchTask,
    putTask,
    TasksRequestError: actual.TasksRequestError,
  };
});

describe("flushTasksOutbox", () => {
  beforeEach(async () => {
    createTask.mockReset();
    patchTask.mockReset();
    putTask.mockReset();
    const db = offlineDbForAccount(offlineAccountKeyFromUsername(username));
    await db.outbox.clear();
    await tasksItemsTable(db).clear();
    await tasksListsTable(db).clear();
    await db.meta.clear();
    await writeTasksBootstrapToCache(username, bootstrap);
  });

  it("marks a queued task write as failed when the server returns 403 after revoke", async () => {
    await enqueueOutboxMutation(username, {
      id: "queued-complete",
      domain: TASKS_DOMAIN,
      op: "update",
      payload: JSON.stringify({
        taskId: task.id,
        patch: { workflowStatus: "completed" },
      }),
    });

    patchTask.mockRejectedValue(new TasksRequestError("PATCH /tasks/items failed (403)", 403));

    const result = await flushTasksOutbox(username);

    expect(result.etagMismatches).toEqual([]);
    const outbox = await listOutboxMutations(username);
    expect(outbox).toHaveLength(1);
    expect(outbox[0]?.lastError).toContain("403");
    expect(outbox[0]?.lastStatus).toBe(403);
    expect(outbox[0]?.retries).toBe(1);
    expect(patchTask).toHaveBeenCalledWith(
      task.id,
      { workflowStatus: "completed" },
      { ifMatch: undefined },
    );
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
});
