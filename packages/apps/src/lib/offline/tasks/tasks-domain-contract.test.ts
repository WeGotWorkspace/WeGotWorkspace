import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import type { TasksAppBootstrap } from "@/lib/api/mock/tasks-bootstrap";
import { createTasksAppBootstrap } from "@/lib/api/mock/tasks-bootstrap";
import type { Task, TasksAPIOperations } from "@/lib/models/tasks-types";
import type { OfflineDomainOperations, OfflineDomainStore } from "@/lib/offline/core/types";
import {
  tasksHybridDomainOperations,
  tasksOfflineDomainStore,
} from "@/lib/offline/tasks/tasks-domain-contract";
import { readTasksChangesState } from "@/lib/offline/tasks/tasks-offline-store";

const username = "bob";
const bootstrap = createTasksAppBootstrap({
  session: {
    ...createTasksAppBootstrap().session,
    user: { ...createTasksAppBootstrap().session.user, username },
  },
}) satisfies TasksAppBootstrap;

/** Compile-time contract checks — referenced so the assignment is not elided. */
const storeContractCheck: OfflineDomainStore<TasksAppBootstrap, Task> = tasksOfflineDomainStore;
const operationsContractCheck: OfflineDomainOperations<TasksAPIOperations> =
  tasksHybridDomainOperations;

void storeContractCheck;
void operationsContractCheck;

describe("tasks domain contract", () => {
  beforeEach(async () => {
    await tasksOfflineDomainStore.writeBootstrap(username, bootstrap);
  });

  it("store contract reads and writes bootstrap", async () => {
    const cached = await tasksOfflineDomainStore.readBootstrap(username);
    expect(cached?.data.tasks).toHaveLength(bootstrap.data.tasks.length);
    expect(cached?.data.taskLists).toHaveLength(bootstrap.data.taskLists.length);
  });

  it("store contract upserts and removes entities", async () => {
    const task = bootstrap.data.tasks[0]!;
    await tasksOfflineDomainStore.upsertEntity(username, { ...task, title: "Renamed" }, true);
    const cached = await tasksOfflineDomainStore.readBootstrap(username);
    expect(cached?.data.tasks.find((row) => row.id === task.id)?.title).toBe("Renamed");

    await tasksOfflineDomainStore.removeEntity(username, task.id);
    const afterRemove = await tasksOfflineDomainStore.readBootstrap(username);
    expect(afterRemove?.data.tasks.some((row) => row.id === task.id)).toBe(false);
  });

  it("store contract keeps one changes state for the whole account", async () => {
    await tasksOfflineDomainStore.writeSyncToken(username, "groceries", "state-1");
    await expect(tasksOfflineDomainStore.readSyncToken(username, "errands")).resolves.toBe(
      "state-1",
    );
    await expect(readTasksChangesState(username)).resolves.toBe("state-1");
  });

  it("operations factory exposes hybrid API methods", () => {
    const operations = tasksHybridDomainOperations(username);
    expect(typeof operations.createTask).toBe("function");
    expect(typeof operations.patchTask).toBe("function");
    expect(typeof operations.deleteTask).toBe("function");
    expect(typeof operations.moveTaskToList).toBe("function");
  });
});
