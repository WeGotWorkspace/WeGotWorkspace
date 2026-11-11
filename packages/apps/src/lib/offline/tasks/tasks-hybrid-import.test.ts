import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTasksAppBootstrap } from "@/lib/api/mock/tasks-bootstrap";
import type { Task } from "@/tasks-core/src/tasks-types";
import { writeTasksBootstrapToCache } from "@/lib/offline/tasks/tasks-offline-store";
import { offlineAccountKeyFromUsername, offlineDbForAccount } from "@/lib/offline/offline-db";
import { tasksItemsTable, tasksListsTable } from "@/lib/offline/tasks/tasks-schema";
import {
  createHybridTasksOperations,
  TASKS_IMPORT_OFFLINE_MESSAGE,
} from "@/lib/offline/tasks/tasks-hybrid-operations";

const username = "import-user";
const bootstrap = createTasksAppBootstrap({
  session: {
    ...createTasksAppBootstrap().session,
    user: { ...createTasksAppBootstrap().session.user, username },
  },
});

vi.mock("@/lib/offline/core/browser-online", () => ({
  readBrowserOnline: vi.fn(() => true),
  isFetchNetworkError: vi.fn(() => false),
  subscribeBrowserOnline: vi.fn(() => () => undefined),
}));

vi.mock("@/lib/api/wgw/tasks", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/wgw/tasks")>();
  return { ...actual, importTasksLive: vi.fn() };
});

vi.mock("@/lib/offline/tasks/tasks-offline-store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/offline/tasks/tasks-offline-store")>();
  return { ...actual, upsertTaskInCache: vi.fn(actual.upsertTaskInCache) };
});

import { importTasksLive } from "@/lib/api/wgw/tasks";
import { upsertTaskInCache } from "@/lib/offline/tasks/tasks-offline-store";
import { readBrowserOnline } from "@/lib/offline/core/browser-online";

describe("hybrid importTasks", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    vi.mocked(readBrowserOnline).mockReturnValue(true);
    const db = offlineDbForAccount(offlineAccountKeyFromUsername(username));
    await db.outbox.clear();
    await tasksItemsTable(db).clear();
    await tasksListsTable(db).clear();
    await db.meta.clear();
    await writeTasksBootstrapToCache(username, bootstrap);
  });

  it("writes imported tasks to the offline cache", async () => {
    const listId = bootstrap.data.taskLists[0]!.id;
    const imported = {
      ...bootstrap.data.tasks[0]!,
      id: "imported-task",
      title: "From the file",
      taskListId: listId,
    } as Task;
    vi.mocked(importTasksLive).mockResolvedValue({
      list: [imported],
      errors: [],
      skipped: { events: 1 },
    });

    const result = await createHybridTasksOperations(username).importTasks!("BEGIN:VCALENDAR", {
      taskListId: listId,
    });

    expect(importTasksLive).toHaveBeenCalledWith("BEGIN:VCALENDAR", { taskListId: listId });
    expect(result.skipped.events).toBe(1);
    const db = offlineDbForAccount(offlineAccountKeyFromUsername(username));
    const cached = (await tasksItemsTable(db).toArray()) as Array<{ id?: string; title?: string }>;
    expect(JSON.stringify(cached)).toContain("From the file");
  });

  it("still reports a server import as done when the cache write fails", async () => {
    const listId = bootstrap.data.taskLists[0]!.id;
    const imported = [
      { ...bootstrap.data.tasks[0]!, id: "imported-a", title: "A", taskListId: listId },
      { ...bootstrap.data.tasks[0]!, id: "imported-b", title: "B", taskListId: listId },
    ] as Task[];
    vi.mocked(importTasksLive).mockResolvedValue({
      list: imported,
      errors: [],
      skipped: { events: 0 },
    });
    vi.mocked(upsertTaskInCache).mockRejectedValueOnce(new Error("QuotaExceededError"));

    const result = await createHybridTasksOperations(username).importTasks!("BEGIN:VCALENDAR", {
      taskListId: listId,
    });

    expect(result.list).toHaveLength(2);
    expect(upsertTaskInCache).toHaveBeenCalledTimes(2);
  });

  it("refuses to import while offline", async () => {
    vi.mocked(readBrowserOnline).mockReturnValue(false);

    await expect(
      createHybridTasksOperations(username).importTasks!("BEGIN:VCALENDAR", {
        taskListId: "inbox",
      }),
    ).rejects.toThrow(TASKS_IMPORT_OFFLINE_MESSAGE);
    expect(importTasksLive).not.toHaveBeenCalled();
  });
});
