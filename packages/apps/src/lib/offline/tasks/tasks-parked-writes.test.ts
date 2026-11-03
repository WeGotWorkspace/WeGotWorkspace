import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TaskCreate } from "@wgw/openapi-types/tasks-types";
import { createTasksAppBootstrap } from "@/lib/api/mock/tasks-bootstrap";
import { offlineAccountKeyFromUsername, offlineDbForAccount } from "@/lib/offline/core/offline-db";
import { listParkedWrites, takeParkedWrites } from "@/lib/offline/core/parked-writes";
import { rescueParkedWrites } from "@/lib/offline/core/rescue-parked-writes";
import {
  parkTask,
  tasksRescueOperations,
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

describe("tasksRescueOperations", () => {
  beforeEach(async () => {
    await offlineDbForAccount(offlineAccountKeyFromUsername(username)).meta.clear();
  });

  it("creates each task anew in an existing list, without its old uid", async () => {
    const createTask = vi.fn(async (_body: TaskCreate) => first);
    const writes = await parkBoth();

    const result = await rescueParkedWrites(
      username,
      TASKS_DOMAIN,
      writes,
      { containerId: "keep" },
      tasksRescueOperations({ createTask }),
    );

    expect(result).toEqual({ containerId: "keep" });
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

    const result = await rescueParkedWrites(
      username,
      TASKS_DOMAIN,
      writes,
      { newContainerName: "Rescued" },
      tasksRescueOperations({ createTask, createTaskList }),
    );

    expect(createTaskList).toHaveBeenCalledWith({ name: "Rescued" });
    expect(result).toEqual({ containerId: "fresh" });
    expect(createTask).toHaveBeenCalledWith(
      expect.objectContaining({ taskListIds: { fresh: true } }),
    );
  });

  it("cannot make a list without createTaskList, and parks every task again", async () => {
    const createTask = vi.fn();
    const writes = await parkBoth();

    await expect(
      rescueParkedWrites(
        username,
        TASKS_DOMAIN,
        writes,
        { newContainerName: "Rescued" },
        tasksRescueOperations({ createTask }),
      ),
    ).rejects.toThrow();

    expect(createTask).not.toHaveBeenCalled();
    expect(await listParkedWrites(username, TASKS_DOMAIN)).toHaveLength(2);
  });
});
