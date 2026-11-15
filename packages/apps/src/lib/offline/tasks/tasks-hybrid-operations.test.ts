import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTasksAppBootstrap } from "@/lib/api/mock/tasks-bootstrap";
import type { Task } from "@/lib/models/tasks-types";
import {
  listOutboxMutations,
  readTasksBootstrapFromCache,
  writeTasksBootstrapToCache,
} from "@/lib/offline/tasks/tasks-offline-store";
import { offlineAccountKeyFromUsername, offlineDbForAccount } from "@/lib/offline/core/offline-db";
import { tasksItemsTable, tasksListsTable } from "@/lib/offline/tasks/tasks-schema";
import { createHybridTasksOperations } from "@/lib/offline/tasks/tasks-hybrid-operations";

const username = "alice";
const bootstrap = createTasksAppBootstrap({
  session: {
    ...createTasksAppBootstrap().session,
    user: { ...createTasksAppBootstrap().session.user, username },
  },
});

const task = {
  ...bootstrap.data.tasks[0]!,
  etag: "etag-1",
} as Task & { etag?: string };

const seededBootstrap = {
  ...bootstrap,
  data: {
    ...bootstrap.data,
    tasks: bootstrap.data.tasks.map((entry) => (entry.id === task.id ? (task as Task) : entry)),
  },
};

vi.mock("@/lib/offline/core/browser-online", () => ({
  readBrowserOnline: vi.fn(() => true),
  isFetchNetworkError: vi.fn((error: unknown) => {
    if (error instanceof TypeError) {
      return error.message.toLowerCase().includes("network");
    }
    return false;
  }),
  subscribeBrowserOnline: vi.fn(() => () => undefined),
}));

vi.mock("@/lib/api/wgw/tasks", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/wgw/tasks")>();
  return {
    ...actual,
    createTask: vi.fn(),
    patchTask: vi.fn(),
    getTask: vi.fn(),
    patchTaskList: vi.fn(),
  };
});

import { createTask, patchTask, patchTaskList } from "@/lib/api/wgw/tasks";
import { readBrowserOnline } from "@/lib/offline/core/browser-online";

describe("createHybridTasksOperations", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    vi.mocked(readBrowserOnline).mockReturnValue(true);
    const db = offlineDbForAccount(offlineAccountKeyFromUsername(username));
    await db.outbox.clear();
    await tasksItemsTable(db).clear();
    await tasksListsTable(db).clear();
    await db.meta.clear();
    await writeTasksBootstrapToCache(username, seededBootstrap);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("queues a create the network cut off under the UID it was first sent with (#2155)", async () => {
    // Safari reports a create cut off by a reload as a network error although
    // the server stored it. The resend must carry the same UID, so the server
    // answers with that task instead of storing a second one.
    vi.mocked(createTask).mockRejectedValue(new TypeError("The network connection was lost."));

    const operations = createHybridTasksOperations(username);
    const queued = await operations.createTask({
      taskListIds: { [task.taskListId]: true },
      title: "Buy milk",
    });

    const sent = vi.mocked(createTask).mock.calls[0]![0];
    expect(sent.uid).toMatch(/^urn:uuid:[0-9a-f-]{36}$/);
    const create = (await listOutboxMutations(username)).find((row) => row.op === "create");
    expect(JSON.parse(create!.payload).body.uid).toBe(sent.uid);
    expect(queued.uid).toBe(sent.uid);
  });

  it("keeps a UID the caller already chose", async () => {
    vi.mocked(createTask).mockRejectedValue(new TypeError("Network request failed"));

    await createHybridTasksOperations(username).createTask({
      taskListIds: { [task.taskListId]: true },
      title: "Chosen",
      uid: "urn:uuid:chosen",
    });

    expect(vi.mocked(createTask).mock.calls[0]![0].uid).toBe("urn:uuid:chosen");
  });

  it("queues patch offline and updates IndexedDB when navigator.onLine is false", async () => {
    vi.mocked(readBrowserOnline).mockReturnValue(false);

    const operations = createHybridTasksOperations(username);
    const saved = await operations.patchTask(task.id, { title: "Updated offline" });

    expect(saved.title).toBe("Updated offline");
    expect(patchTask).not.toHaveBeenCalled();

    const cached = await readTasksBootstrapFromCache(username);
    expect(cached?.data.tasks.find((entry) => entry.id === task.id)?.title).toBe("Updated offline");

    const outbox = await listOutboxMutations(username);
    expect(outbox).toHaveLength(1);
    expect(outbox[0]?.op).toBe("update");
    expect(outbox[0]?.ifInState).toBe("etag-1");
  });

  it("turns a queued move into the undo instead of queueing a second move", async () => {
    vi.mocked(readBrowserOnline).mockReturnValue(false);
    const operations = createHybridTasksOperations(username);
    const from = task.taskListId;
    const to = from === "work" ? "default" : "work";

    await operations.moveTaskToList(task.id, to);
    await operations.moveTaskToList(task.id, from);

    const outbox = await listOutboxMutations(username);
    expect(outbox.map((row) => row.op)).toEqual(["move"]);
    expect(JSON.parse(outbox[0]!.payload)).toEqual({ taskId: task.id, taskListId: from });
    expect(outbox[0]!.ifInState).toBe("etag-1");
    const cached = await readTasksBootstrapFromCache(username);
    expect(cached?.data.tasks.find((entry) => entry.id === task.id)?.taskListId).toBe(from);
  });

  it("queues patch when live API fails with a network error", async () => {
    vi.mocked(readBrowserOnline).mockReturnValue(true);
    vi.mocked(patchTask).mockRejectedValue(new TypeError("network request failed"));

    const operations = createHybridTasksOperations(username);
    const saved = await operations.patchTask(task.id, { title: "Queued after network error" });

    expect(saved.title).toBe("Queued after network error");
    expect(patchTask).toHaveBeenCalledOnce();

    const outbox = await listOutboxMutations(username);
    expect(outbox).toHaveLength(1);
    expect(outbox[0]?.op).toBe("update");
  });

  it("persists shareWith on cached lists and refuses offline share grants", async () => {
    const shareWith = {
      bob: { mayRead: true, mayWrite: false, mayShare: false, mayDelete: false },
    };
    vi.mocked(patchTaskList).mockResolvedValue({
      ...seededBootstrap.data.taskLists[0]!,
      shareWith,
    });

    const operations = createHybridTasksOperations(username);
    const updated = await operations.patchTaskList!("inbox", { shareWith });
    expect(updated.shareWith).toEqual(shareWith);
    const cached = await readTasksBootstrapFromCache(username);
    expect(cached?.data.taskLists.find((list) => list.id === "inbox")?.shareWith).toEqual(
      shareWith,
    );

    vi.mocked(readBrowserOnline).mockReturnValue(false);
    await expect(
      operations.patchTaskList!("inbox", {
        shareWith: {
          carol: { mayRead: true, mayWrite: true, mayShare: false, mayDelete: false },
        },
      }),
    ).rejects.toThrow("Sharing changes require a connection.");
    await expect(listOutboxMutations(username)).resolves.toEqual([]);
  });

  it("refuses offline owner transfers", async () => {
    const operations = createHybridTasksOperations(username);
    vi.mocked(readBrowserOnline).mockReturnValue(false);
    await expect(operations.patchTaskList!("work", { groupSlug: "team" })).rejects.toThrow(
      "Owner changes require a connection.",
    );
    await expect(
      operations.patchTaskList!("work", { name: "Desk", groupSlug: null }),
    ).rejects.toThrow("Owner changes require a connection.");
    await expect(listOutboxMutations(username)).resolves.toEqual([]);
  });
});
