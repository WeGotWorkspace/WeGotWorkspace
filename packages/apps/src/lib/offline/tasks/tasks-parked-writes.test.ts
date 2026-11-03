import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TaskCreate } from "@wgw/openapi-types/tasks-types";
import { createTasksAppBootstrap } from "@/lib/api/mock/tasks-bootstrap";
import { offlineAccountKeyFromUsername, offlineDbForAccount } from "@/lib/offline/core/offline-db";
import { listParkedWrites, takeParkedWrites } from "@/lib/offline/core/parked-writes";
import {
  parkTask,
  rescueParkedTasks,
  TaskRescueError,
  type ParkedTask,
} from "@/lib/offline/tasks/tasks-parked-writes";
import { TASKS_DOMAIN } from "@/lib/offline/tasks/tasks-schema";

const username = "rescue-user";
const [first, second] = createTasksAppBootstrap().data.tasks as [
  ParkedTask["item"],
  ParkedTask["item"],
];

async function parkBoth(): Promise<ParkedTask[]> {
  await parkTask(
    username,
    { ...first, uid: "uid-1" },
    { kind: "create", reason: "gone", containerName: "Old" },
  );
  await parkTask(username, second, { kind: "edit", reason: "readOnly", containerName: "Old" });
  const writes = await listParkedWrites<ParkedTask["item"]>(username, TASKS_DOMAIN);
  return takeParkedWrites(
    username,
    TASKS_DOMAIN,
    writes.map((write) => write.id),
  );
}

describe("rescueParkedTasks", () => {
  beforeEach(async () => {
    await offlineDbForAccount(offlineAccountKeyFromUsername(username)).meta.clear();
  });

  it("creates each task anew in an existing list, without its old uid", async () => {
    const createTask = vi.fn(async (_body: TaskCreate) => first);
    const writes = await parkBoth();

    const result = await rescueParkedTasks(username, writes, { listId: "keep" }, { createTask });

    expect(result).toEqual({ listId: "keep" });
    expect(createTask.mock.calls.map(([body]) => body)).toEqual([
      expect.objectContaining({ title: first.title, taskListIds: { keep: true } }),
      expect.objectContaining({ title: second.title, taskListIds: { keep: true } }),
    ]);
    expect(createTask.mock.calls[0]![0]).not.toHaveProperty("uid");
    expect(await listParkedWrites(username, TASKS_DOMAIN)).toEqual([]);
  });

  it("makes the new list first", async () => {
    const createTaskList = vi.fn(async () => ({ id: "fresh", name: "Rescued" }) as never);
    const createTask = vi.fn(async () => first);
    const writes = await parkBoth();

    const result = await rescueParkedTasks(
      username,
      writes,
      { newListName: "Rescued" },
      { createTask, createTaskList },
    );

    expect(createTaskList).toHaveBeenCalledWith({ name: "Rescued" });
    expect(result).toEqual({ listId: "fresh" });
    expect(createTask).toHaveBeenCalledWith(
      expect.objectContaining({ taskListIds: { fresh: true } }),
    );
  });

  it("parks a task again when it could not be created", async () => {
    const createTask = vi
      .fn()
      .mockResolvedValueOnce(first)
      .mockRejectedValueOnce(new Error("offline"));
    const writes = await parkBoth();

    await expect(
      rescueParkedTasks(username, writes, { listId: "keep" }, { createTask }),
    ).rejects.toBeInstanceOf(TaskRescueError);

    const left = await listParkedWrites<ParkedTask["item"]>(username, TASKS_DOMAIN);
    expect(left.map((write) => write.entityId)).toEqual([second.id]);
  });

  it("parks every task again when the new list cannot be made", async () => {
    const createTaskList = vi.fn().mockRejectedValue(new Error("offline"));
    const createTask = vi.fn();
    const writes = await parkBoth();

    await expect(
      rescueParkedTasks(
        username,
        writes,
        { newListName: "Rescued" },
        { createTask, createTaskList },
      ),
    ).rejects.toThrow("offline");

    expect(createTask).not.toHaveBeenCalled();
    expect(await listParkedWrites(username, TASKS_DOMAIN)).toHaveLength(2);
  });
});
