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

const { patchTask } = vi.hoisted(() => ({
  patchTask: vi.fn(),
}));

vi.mock("@/lib/api/wgw/tasks", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/wgw/tasks")>();
  return {
    ...actual,
    patchTask,
    TasksRequestError: actual.TasksRequestError,
  };
});

describe("flushTasksOutbox", () => {
  beforeEach(async () => {
    patchTask.mockReset();
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
});
