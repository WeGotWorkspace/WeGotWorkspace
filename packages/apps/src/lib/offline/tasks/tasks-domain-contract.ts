import type { TasksAppBootstrap } from "@/lib/api/mock/tasks-bootstrap";
import type { Task, TasksAPIOperations } from "@/lib/models/tasks-types";
import { createHybridTasksOperations } from "@/lib/offline/tasks/tasks-hybrid-operations";
import {
  readTasksBootstrapFromCache,
  readTasksChangesState,
  removeTaskFromCache,
  upsertTaskInCache,
  writeTasksBootstrapToCache,
  writeTasksChangesState,
} from "@/lib/offline/tasks/tasks-offline-store";
import type { OfflineDomainOperations, OfflineDomainStore } from "@/lib/offline/core/types";

/**
 * Tasks persistence wired to {@link OfflineDomainStore}. Domain-specific helpers
 * (list rows, outbox coalescing, temp ids) stay on `tasks-offline-store.ts`.
 *
 * Tasks keeps one changes state for the whole account, so the token scope is
 * not used: every scope reads and writes that one state.
 */
export const tasksOfflineDomainStore = {
  readBootstrap: readTasksBootstrapFromCache,
  writeBootstrap: writeTasksBootstrapToCache,
  upsertEntity: upsertTaskInCache,
  removeEntity: removeTaskFromCache,
  readSyncToken: (username, _scope) => readTasksChangesState(username),
  writeSyncToken: (username, _scope, token) => writeTasksChangesState(username, token),
} satisfies OfflineDomainStore<TasksAppBootstrap, Task>;

/** Tasks hybrid API factory wired to {@link OfflineDomainOperations}. */
export const tasksHybridDomainOperations: OfflineDomainOperations<TasksAPIOperations> =
  createHybridTasksOperations;
