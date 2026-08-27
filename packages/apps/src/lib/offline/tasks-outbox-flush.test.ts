import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTasksAppBootstrap } from "@/lib/api/mock/tasks-bootstrap";
import { TasksRequestError } from "@/lib/api/wgw/tasks";
import { TASKS_DOMAIN } from "@/lib/offline/tasks/tasks-schema";
import {
  enqueueOutboxMutation,
  listOutboxMutations,
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
    expect(outbox[0]?.retries).toBe(1);
    expect(patchTask).toHaveBeenCalledWith(
      task.id,
      { workflowStatus: "completed" },
      { ifMatch: undefined },
    );
  });
});
