import "fake-indexeddb/auto";
import { describe, expect, it, beforeEach } from "vitest";
import type { TasksAppBootstrap } from "@/lib/api/mock/tasks-bootstrap";
import { createTasksAppBootstrap } from "@/lib/api/mock/tasks-bootstrap";
import type { Task } from "@/tasks-core/src/tasks-types";
import { offlineAccountKeyFromUsername, offlineDbForAccount } from "@/lib/offline/offline-db";
import { TASKS_DOMAIN } from "@/lib/offline/tasks/tasks-schema";
import {
  enqueueCoalescedTaskUpdate,
  enqueueOutboxMutation,
  listOutboxMutations,
  readTasksBootstrapFromCache,
  upsertTaskInCache,
  writeTasksBootstrapToCache,
} from "@/lib/offline/tasks/tasks-offline-store";

const username = "bob";
const bootstrap = createTasksAppBootstrap({
  session: {
    ...createTasksAppBootstrap().session,
    user: { ...createTasksAppBootstrap().session.user, username },
  },
}) satisfies TasksAppBootstrap;

describe("tasks offline store", () => {
  beforeEach(async () => {
    await writeTasksBootstrapToCache(username, bootstrap);
    const db = offlineDbForAccount(offlineAccountKeyFromUsername(username));
    await db.outbox.clear();
  });

  it("reads bootstrap written to cache", async () => {
    const cached = await readTasksBootstrapFromCache(username);
    expect(cached?.data.tasks.length).toBeGreaterThan(0);
    expect(cached?.data.taskLists.length).toBeGreaterThan(0);
  });

  it("preserves pendingSync tasks when bootstrap is rewritten from server", async () => {
    const localTask = {
      ...bootstrap.data.tasks[0]!,
      title: "Offline edit",
    } as Task;
    await upsertTaskInCache(username, localTask, true);

    await writeTasksBootstrapToCache(username, bootstrap);

    const cached = await readTasksBootstrapFromCache(username);
    expect(cached?.data.tasks.find((task) => task.id === localTask.id)?.title).toBe("Offline edit");
  });

  it("coalesces offline update rows for the same taskId", async () => {
    const taskId = bootstrap.data.tasks[0]!.id;
    await enqueueCoalescedTaskUpdate(username, taskId, { title: "A" }, "etag-1");
    await enqueueCoalescedTaskUpdate(username, taskId, { title: "B" }, "etag-1");

    const rows = await listOutboxMutations(username);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.domain).toBe(TASKS_DOMAIN);
    expect(JSON.parse(rows[0]!.payload).patch.title).toBe("B");
    expect(rows[0]?.ifInState).toBe("etag-1");
  });

  it("orders outbox mutations by createdAt", async () => {
    await enqueueOutboxMutation(username, {
      id: "b",
      domain: TASKS_DOMAIN,
      op: "update",
      payload: "{}",
    });
    await new Promise((resolve) => setTimeout(resolve, 5));
    await enqueueOutboxMutation(username, {
      id: "a",
      domain: TASKS_DOMAIN,
      op: "update",
      payload: "{}",
    });
    const rows = await listOutboxMutations(username);
    expect(rows.map((row) => row.id)).toEqual(["b", "a"]);
  });
});
